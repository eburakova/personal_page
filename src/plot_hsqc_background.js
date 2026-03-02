const margin = { top: 20, right: 20, bottom: 60, left: 60 };
const width = 900 - margin.left - margin.right;
const height = 800 - margin.top - margin.bottom;
const peakSize = 3

const svg = d3
  .select("#plot")
  .attr("width", width + margin.left + margin.right)
  .attr("height", height + margin.top + margin.bottom)
  .append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

// make SVG scalable and cover
d3.select("#plot")
  .attr(
    "viewBox",
    `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`,
  )
  .attr("preserveAspectRatio", "xMidYMid slice");
//  .style("pointer-events", "none");
// const tooltip = d3.select("#tooltip");

// Load data
Promise.all([
  d3.json("data/spectrum.json"),
  d3.csv("data/N15HSQC_assigned.csv")
])
  .then(([specData, peakData]) => {
    const spectrum = specData.spectrum;
    const xLimits = specData.H_limits; // Nitrogen (approx 105-133)
    const yLimits = specData.N_limits; // Hydrogen (approx 5.5-12.0)

    // peaks data: w1 is Nitrogen (y-axis in JSON context, but x-axis here), w2 is Hydrogen
    const peaks = peakData.map(d => ({
      assignment: d.Assignment,
      w1: +d.w2, // N15
      w2: +d.w1  // H1
    }));

    // Create scales (inverted for NMR convention)
    // xScale: maps ppm (Nitrogen) to screen width
    const xScale = d3
      .scaleLinear()
      .domain([xLimits.max, xLimits.min])
      .range([0, width]);

    // yScale: maps ppm (Hydrogen) to screen height
    const yScale = d3
      .scaleLinear()
      .domain([yLimits.min, yLimits.max])
      .range([0, height]);

    // Generate contours from spectrum data
    // Spectrum is transposed (1024 x 370), so:
    // specHeight = 1024 (Nitrogen axis)
    // specWidth = 370 (Hydrogen axis)
    const specHeight = spectrum.length;
    const specWidth = spectrum[0].length;

    // Generate 4 visible contour levels
    const contourGenerator = d3
      .contours()
      .size([specWidth, specHeight])
      .thresholds([0.1, 0.25, 0.7, 0.9]);

    // Flatten spectrum for contour generation
    let flatSpectrum = [];
    for (let i = 0; i < specHeight; i++) {
      for (let j = 0; j < specWidth; j++) {
        flatSpectrum.push(Math.abs(spectrum[i][j]));
      }
    }

    // Normalize spectrum
    const maxVal = d3.max(flatSpectrum);
    const normalized = flatSpectrum.map((v) => v / maxVal);

    const contours = contourGenerator(normalized);

    // Scales for mapping spectrum coordinates to plot coordinates
    // specXScale: maps j (0 to 370) to Hydrogen ppm (xLimits)
    // specYScale: maps i (0 to 1024) to Nitrogen ppm (yLimits)
    // WAIT: our plot's x-axis is Nitrogen, y-axis is Hydrogen.
    
    // specX corresponds to index j (Hydrogen dimension)
    const specXScale = d3
      .scaleLinear()
      .domain([0, specWidth])
      .range([yLimits.max, yLimits.min]); // Hydrogen

    // specY corresponds to index i (Nitrogen dimension)
    const specYScale = d3
      .scaleLinear()
      .domain([0, specHeight])
      .range([xLimits.max, xLimits.min]); // Nitrogen

    // Draw contours using geoPath with a custom projection that maps
    // contour coordinates (spectrum pixel coords) -> ppm -> screen coords
    console.log("contours count:", contours.length);

    const projection = d3.geoTransform({
      point: function (x, y) {
        // x is specX (Hydrogen), y is specY (Nitrogen)
        const ppmH = specXScale(x);
        const ppmN = specYScale(y);
        
        // Map ppm to screen coords
        // xScale expects Nitrogen, yScale expects Hydrogen
        const px = xScale(ppmN);
        const py = yScale(ppmH);
        this.stream.point(px, py);
      },
    });

    const pathGenerator = d3.geoPath().projection(projection);

    svg
      .selectAll(".contour")
      .data(contours)
      .enter()
      .append("path")
      .attr("class", (d, i) => `contour contour-level-${i + 1}`)
      .attr("d", (d) => {
        // d is a Geo-like object with "coordinates" as MultiPolygon rings
        // Wrap as a Feature for geoPath
        const feature = {
          type: "Feature",
          geometry: { type: d.type, coordinates: d.coordinates },
        };
        return pathGenerator(feature) || "";
      });

    // Tooltip selection
    // const tooltip = d3.select("#tooltip");

    // Draw peaks
    const nodes = peaks.map((d, i) => ({
      id: i,
      x: xScale(d.w1),
      y: yScale(d.w2),
      fx: xScale(d.w1), // fixed x for peak center
      fy: yScale(d.w2), // fixed y for peak center
      assignment: d.assignment,
      w1: d.w1,
      w2: d.w2
    }));

    const labelNodes = peaks.map((d, i) => ({
      id: i,
      x: xScale(d.w1) + 10,
      y: yScale(d.w2) - 10,
      targetX: xScale(d.w1),
      targetY: yScale(d.w2),
      assignment: d.assignment
    }));

    // Estimate label bounding radius for collisions (approximate text box)
    // Assume ~6px height and ~4px per character width

    labelNodes.forEach(n => {
      const w = Math.max(12, 4 * n.assignment.length);
      const h = 8; // css .label font-size ~8px
      n.radius = Math.sqrt((w * 0.5) ** 2 + (h * 0.5) ** 2);
    });

    // Obstacles for labels to avoid: fixed peak centers
    const obstacles = nodes.map(n => ({
      x: n.fx,
      y: n.fy,
      fx: n.fx,
      fy: n.fy,
      radius: 10
    }));

    // For the background plot, we run the simulation for each label only on hover
    function layoutLabelOnHover(d,
      repulsionPx = 4,
      contoursStrength = 0.9,
      avoidAnchorStrength = 4,
      attractStrength = 1,
    ) {
      // Find the corresponding labelNode
      const node = labelNodes.find(n => n.id === d.id);
      if (!node) return;

      // Reset to target (plus slight offset)
      node.x = node.targetX + 5;
      node.y = node.targetY - 5;
      node.vx = 0;
      node.vy = 0;

      // Simple simulation for JUST THIS ONE NODE
      // Other nodes (obstacles) are fixed
      function forceContours() {
        const ppmN = xScale.invert(node.x);
        const ppmH = yScale.invert(node.y);
        const sY = Math.round(specYScale.invert(ppmN));
        const sX = Math.round(specXScale.invert(ppmH));

        if (sY >= 0 && sY < specHeight && sX >= 0 && sX < specWidth) {
          const intensity = Math.abs(spectrum[sY][sX]) / maxVal;
          if (intensity > 0.05) {
            const dx = node.x - node.targetX;
            const dy = node.y - node.targetY;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const push = intensity * contoursStrength;
            node.vx += (dx / dist) * push;
            node.vy += (dy / dist) * push;
          }
        }
      }

      function avoidAnchor() {
          const minDist = 7 + repulsionPx;
          const dx = node.x - node.targetX;
          const dy = node.y - node.targetY;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (!dist) dist = 0.001;
          if (dist < minDist) {
            const k = (minDist - dist) / minDist;
            node.vx += (dx / dist) * k * avoidAnchorStrength;
            node.vy += (dy / dist) * k * avoidAnchorStrength;
          }
      }

      function attractToTarget() {
          const dx = node.targetX - node.x;
          const dy = node.targetY - node.y;
          node.vx += dx * attractStrength * 0.1;
          node.vy += dy * attractStrength * 0.1;
      }

      // Run few ticks
      for (let i = 0; i < 50; i++) {
        forceContours();
        avoidAnchor();
        attractToTarget();
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.5; // damping
        node.vy *= 0.5;
      }
    }

    // layoutLabels function remains (maybe useful for hsqc_plot.html)
    function layoutLabels(
      repulsionPx = 4,
      contoursStrength = 0.9,
      avoidAnchorStrength = 4,
      attractStrength = 1,
      collideStrength = 0.2
    ) {
      const simNodes = labelNodes.concat(obstacles);

      // Custom force to avoid contours
      // We'll use the normalized spectrum data to push nodes away from high intensity areas
      function forceContours() {
        const strength = contoursStrength;
        for (let i = 0, n = labelNodes.length; i < n; ++i) {
          const node = labelNodes[i];

          const ppmN = xScale.invert(node.x);
          const ppmH = yScale.invert(node.y);
          const sY = Math.round(specYScale.invert(ppmN));
          const sX = Math.round(specXScale.invert(ppmH));

          if (sY >= 0 && sY < specHeight && sX >= 0 && sX < specWidth) {
            const intensity = Math.abs(spectrum[sY][sX]) / maxVal;
            if (intensity > 0.05) { // Only penalize if above some threshold
              const dx = node.x - node.targetX;
              const dy = node.y - node.targetY;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const push = intensity * strength;
              node.vx += (dx / dist) * push;
              node.vy += (dy / dist) * push;
            }
          }
        }
      }

      const simulation = d3.forceSimulation(simNodes)
        .force("x", d3.forceX(d => (d.targetX !== undefined ? d.targetX : d.fx)).strength(attractStrength))
        .force("y", d3.forceY(d => (d.targetY !== undefined ? d.targetY : d.fy)).strength(attractStrength))
        .force("collide", d3.forceCollide(d => (d.fx === undefined ? (d.radius + repulsionPx) : d.radius)).strength(collideStrength))
        .force("contours", forceContours)
        .force("avoidAnchor", (alpha) => {
          const minDist = 7 + repulsionPx; // minimum px away from its own peak
          for (let i = 0, n = labelNodes.length; i < n; ++i) {
            const node = labelNodes[i];
            const dx = node.x - node.targetX;
            const dy = node.y - node.targetY;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (!dist) dist = 0.001;
            if (dist < minDist) {
              const k = (minDist - dist) / minDist;
              node.vx += (dx / dist) * k * avoidAnchorStrength * alpha;
              node.vy += (dy / dist) * k * avoidAnchorStrength * alpha;
            }
          }
        })
        .stop();

      for (let i = 0; i < 150; ++i) simulation.tick();
    }

    // Initial layout with default repulsion (NO, we do it on hover now)
    // layoutLabels(4, 0.3, 0.9, 1.2, 4, 1, 0.2);

    const peakGroups = svg
      .selectAll(".peak-group")
      .data(labelNodes)
      .enter()
      .append("g")
      .attr("class", "peak-group");

    peakGroups
      .append("line")
      .attr("class", "peak-x-1")
      .attr("x1", (d) => d.targetX - peakSize)
      .attr("y1", (d) => d.targetY - peakSize)
      .attr("x2", (d) => d.targetX + peakSize)
      .attr("y2", (d) => d.targetY + peakSize);

    peakGroups
      .append("line")
      .attr("class", "peak-x-2")
      .attr("x1", (d) => d.targetX + peakSize)
      .attr("y1", (d) => d.targetY - peakSize)
      .attr("x2", (d) => d.targetX - peakSize)
      .attr("y2", (d) => d.targetY + peakSize);

    peakGroups
      .append("rect")
      .attr("class", "peak-hitbox")
      .attr("x", (d) => d.targetX - peakSize*2)
      .attr("y", (d) => d.targetY - peakSize*2)
      .attr("width", 12)
      .attr("height", 12)
      .style("fill", "transparent")
      .attr("pointer-events", "all")
      .style("cursor", "pointer")
      .on("mouseover", function (event, d) {
        const group = d3.select(this.parentNode);

        // Bring to front to simulate high z-order
        group.raise();

        group.classed("hovered", true);

        // Run repulsion logic ONLY on hover
        layoutLabelOnHover(d);

        // Use updated position
        const labelNode = labelNodes.find(n => n.id === d.id);

        // Setup for the label background and text at their final positions
        group.select(".label")
            .attr("x", labelNode.x)
            .attr("y", labelNode.y)
            .each(function(d) {
                const bbox = this.getBBox();
                group.select(".label-bg")
                    .attr("x", bbox.x - 2)
                    .attr("y", bbox.y - 1)
                    .attr("width", bbox.width + 4)
                    .attr("height", bbox.height + 2);
            });
      })
      .on("mouseout", function (event, d) {
        const group = d3.select(this.parentNode);
        group.classed("hovered", false);
      });

    peakGroups
      .append("rect")
      .attr("class", "label-bg")
      .attr("rx", 2)
      .attr("ry", 2);

    peakGroups
      .append("text")
      .attr("class", "label")
      .attr("x", (d) => d.x)
      .attr("y", (d) => d.y)
      // .style("display", "none")
      .text((d) => d.assignment)
      .each(function(d) {
        const bbox = this.getBBox();
        d3.select(this.parentNode).select(".label-bg")
          .attr("x", bbox.x - 2)
          .attr("y", bbox.y - 1)
          .attr("width", bbox.width + 4)
          .attr("height", bbox.height + 2);
      });

    function updateLabelPositions() {
      svg.selectAll(".label")
        .data(labelNodes)
        .attr("x", d => d.x)
        .attr("y", d => d.y)
        .each(function(d) {
          const bbox = this.getBBox();
          d3.select(this.parentNode).select(".label-bg")
            .attr("x", bbox.x - 2)
            .attr("y", bbox.y - 1)
            .attr("width", bbox.width + 4)
            .attr("height", bbox.height + 2);
        });
    }

    // Hook up repulsion sliders if present (standalone spectrum page only)
    const repulsionSlider = document.getElementById("repulsion-slider");
    const repulsionValue = document.getElementById("repulsion-value");

    // Additional strength sliders (standalone page only)
    const contoursSlider = document.getElementById("contours-strength-slider");
    const contoursValue = document.getElementById("contours-strength-value");

    const avoidAnchorSlider = document.getElementById("avoid-anchor-strength-slider");
    const avoidAnchorValue = document.getElementById("avoid-anchor-strength-value");

    const attractSlider = document.getElementById("attract-strength-slider");
    const attractValue = document.getElementById("attract-strength-value");

    const collideSlider = document.getElementById("collide-strength-slider");
    const collideValue = document.getElementById("collide-strength-value");

    if (repulsionSlider) {
      const apply = () => {
        const r = +repulsionSlider.value;

        const cs = contoursSlider ? +contoursSlider.value : 1.0;
        const aas = avoidAnchorSlider ? +avoidAnchorSlider.value : 2.0;
        const as = attractSlider ? +attractSlider.value : 0.5;
        const cols = collideSlider ? +collideSlider.value : 1.0;

        if (repulsionValue) repulsionValue.textContent = String(r);
        if (contoursValue) contoursValue.textContent = String(cs);
        if (avoidAnchorValue) avoidAnchorValue.textContent = String(aas);
        if (attractValue) attractValue.textContent = String(as);
        if (collideValue) collideValue.textContent = String(cols);

        layoutLabels(r, cs, aas, as, cols);
        updateLabelPositions();
      };
      // Initialize and listen for changes
      apply();
      repulsionSlider.addEventListener("input", apply);
      repulsionSlider.addEventListener("change", apply);

      // Wire up additional sliders
      if (contoursSlider) {
        contoursSlider.addEventListener("input", apply);
        contoursSlider.addEventListener("change", apply);
      }
      if (avoidAnchorSlider) {
        avoidAnchorSlider.addEventListener("input", apply);
        avoidAnchorSlider.addEventListener("change", apply);
      }
      if (attractSlider) {
        attractSlider.addEventListener("input", apply);
        attractSlider.addEventListener("change", apply);
      }
      if (collideSlider) {
        collideSlider.addEventListener("input", apply);
        collideSlider.addEventListener("change", apply);
      }
    } else {
      // For main page without slider
      updateLabelPositions();
    }
  })
  .catch((error) => {
    console.error("Error loading data:", error);
    d3.select("#plot-container")
      .append("p")
      .style("color", "red")
      .text("Error loading data: " + error);
  });
