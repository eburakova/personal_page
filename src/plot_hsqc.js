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

    // Use d3-force to avoid label overlap
    // Since we only show them on hover, maybe we want them pre-positioned or 
    // we want them all visible? The user said "make the text labels dodge all other elements".
    // Usually this means they are all visible or we want a stable position.
    // Let's assume we want to pre-calculate positions for all labels so they don't overlap 
    // when they *do* appear (or if the user decides to make them all visible later).

    const simulation = d3.forceSimulation(labelNodes)
      .force("x", d3.forceX(d => d.targetX).strength(0.8))
      .force("y", d3.forceY(d => d.targetY).strength(0.8))
      .force("collide", d3.forceCollide(12)) // Approx label width/height
      .stop();

    // Run simulation to convergence
    for (let i = 0; i < 120; ++i) simulation.tick();

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
        group.selectAll("line").style("display", "block").transition().duration(200).style("stroke-width", 3);
        group.select(".label").style("display", "block");
      })
      .on("mouseout", function () {
        const group = d3.select(this.parentNode);
        group.selectAll("line").style("display", "none").transition().duration(200).style("stroke-width", 1.5);
        group.select(".label").style("display", "none");
      });

    peakGroups
      .append("text")
      .attr("class", "label")
      .attr("x", (d) => d.x)
      .attr("y", (d) => d.y)
      .style("display", "none")
      .text((d) => d.assignment);
  })
  .catch((error) => {
    console.error("Error loading data:", error);
    d3.select("#plot-container")
      .append("p")
      .style("color", "red")
      .text("Error loading data: " + error);
  });
