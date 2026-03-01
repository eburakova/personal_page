const margin = { top: 20, right: 20, bottom: 60, left: 60 };
const width = 900 - margin.left - margin.right;
const height = 800 - margin.top - margin.bottom;

const svg = d3
  .select("#plot")
  .attr("width", width + margin.left + margin.right)
  .attr("height", height + margin.top + margin.bottom)
  .append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

const tooltip = d3.select("#tooltip");

// Load data
Promise.all([d3.json("./spectrum.json"), d3.csv("./N15HSQC_assigned.csv")])
  .then(([specData, peakData]) => {
    const spectrum = specData.spectrum;
    const xLimits = specData.x_limits; // H (w1)
    const yLimits = specData.y_limits; // N (w2)

    // Create scales (inverted for NMR convention)
    const xScale = d3
      .scaleLinear()
      .domain([xLimits.max, xLimits.min])
      .range([0, width]); // Right to left

    const yScale = d3
      .scaleLinear()
      .domain([yLimits.max, yLimits.min])
      .range([0, height]); // Top to bottom

    // Axes
    const xAxis = d3.axisBottom(xScale);
    const yAxis = d3.axisLeft(yScale);

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis);

    svg.append("g").attr("class", "axis").call(yAxis);

    // Axis labels
    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("x", width / 2)
      .attr("y", height + 45)
      .attr("text-anchor", "middle")
      .text("¹H (ppm) - w1");

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", -45)
      .attr("text-anchor", "middle")
      .text("¹⁵N (ppm) - w2");

    // Generate contours from spectrum data
    const specWidth = spectrum[0].length;
    const specHeight = spectrum.length;

    // Create 2D array from spectrum
    let values = [];
    for (let y = 0; y < specHeight; y++) {
      for (let x = 0; x < specWidth; x++) {
        values.push({
          x: x,
          y: y,
          value: Math.abs(spectrum[y][x]),
        });
      }
    }

    // Generate 4 visible contour levels
    const contourGenerator = d3
      .contours()
      .size([specWidth, specHeight])
      .thresholds([0.25, 0.5, 0.7, 0.9]);

    // Flatten spectrum for contour generation
    let flatSpectrum = [];
    for (let y = 0; y < specHeight; y++) {
      for (let x = 0; x < specWidth; x++) {
        flatSpectrum.push(Math.abs(spectrum[y][x]));
      }
    }

    // Normalize spectrum
    const maxVal = Math.max(...flatSpectrum);
    const normalized = flatSpectrum.map((v) => v / maxVal);

    const contours = contourGenerator(normalized);

    // Scales for mapping spectrum coordinates to plot coordinates
    // Map from spectrum pixel coords to ppm values
    const specXScale = d3
      .scaleLinear()
      .domain([0, specWidth])
      .range([xLimits.max, xLimits.min]);

    const specYScale = d3
      .scaleLinear()
      .domain([0, specHeight])
      .range([yLimits.max, yLimits.min]);

    // Draw contours
    const pathGenerator = d3.geoPath();

    svg
      .selectAll(".contour")
      .data(contours)
      .enter()
      .append("path")
      .attr("class", (d, i) => `contour contour-level-${i + 1}`)
      .attr("d", (d) => {
        // Convert contour coordinates from spectrum space to plot space
        const path = d.coordinates.map((ring) => {
          return ring.map((point) => {
            const ppmX = specXScale(point[0]);
            const ppmY = specYScale(point[1]);
            return [xScale(ppmX), yScale(ppmY)];
          });
        });

        if (!path[0] || path[0].length === 0) return "";

        // Build SVG path string
        let pathStr = "M" + path[0][0][0] + "," + path[0][0][1];
        for (let j = 1; j < path[0].length; j++) {
          pathStr += "L" + path[0][j][0] + "," + path[0][j][1];
        }
        pathStr += "Z";
        return pathStr;
      })
      .on("mouseover", function (event, d) {
        d3.select(this).style("stroke-width", 2.5).style("opacity", 1);
        tooltip
          .style("display", "block")
          .html(`Contour level: ${d.value.toFixed(3)}`);
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY - 30 + "px");
      })
      .on("mouseout", function (event, d) {
        d3.select(this).style("stroke-width", 1.5);
        tooltip.style("display", "none");
      });

    // Plot peaks from CSV
    const peaks = peakData.map((d) => ({
      label: d.Assignment,
      h: parseFloat(d.w1),
      n: parseFloat(d.w2),
    }));

    // Draw peak circles
    svg
      .selectAll(".peak-circle")
      .data(peaks)
      .enter()
      .append("circle")
      .attr("class", "peak-circle")
      .attr("cx", (d) => xScale(d.h))
      .attr("cy", (d) => yScale(d.n))
      .attr("r", 4)
      .on("mouseover", function (event, d) {
        tooltip
          .style("display", "block")
          .html(
            d.label +
              "<br>¹H: " +
              d.h.toFixed(2) +
              " ppm<br>¹⁵N: " +
              d.n.toFixed(2) +
              " ppm",
          );
        d3.select(this).attr("r", 6).attr("stroke-width", 2.5);
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY - 30 + "px");
      })
      .on("mouseout", function () {
        tooltip.style("display", "none");
        d3.select(this).attr("r", 4).attr("stroke-width", 1);
      });

    // Draw labels
    svg
      .selectAll(".label")
      .data(peaks)
      .enter()
      .append("text")
      .attr("class", "label")
      .attr("x", (d) => xScale(d.h) + 5)
      .attr("y", (d) => yScale(d.n) - 5)
      .text((d) => d.label)
      .style("font-size", "9px");
  })
  .catch((error) => {
    console.error("Error loading data:", error);
    d3.select("#plot-container")
      .append("p")
      .style("color", "red")
      .text("Error loading data: " + error);
  });
