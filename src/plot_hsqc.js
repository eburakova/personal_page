const margin = { top: 20, right: 20, bottom: 60, left: 60 };
const width = 900 - margin.left - margin.right;
const height = 800 - margin.top - margin.bottom;

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
  .attr("preserveAspectRatio", "xMidYMid slice")
  .style("width", "100vw")
  .style("height", "100vh")
  .style("position", "fixed")
  .style("left", "0")
  .style("top", "0")
  .style("z-index", "-1");
//  .style("pointer-events", "none");
// const tooltip = d3.select("#tooltip");

// Load data (temporarily only spectrum; CSV/peaks commented out)
Promise.all([d3.json("data/spectrum.json")])
  .then(([specData]) => {
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
      .range([height, 0]); // Top to bottom

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
          value: spectrum[y][x],
        });
      }
    }

    // Generate 4 visible contour levels
    const contourGenerator = d3
      .contours()
      .size([specWidth, specHeight])
      .thresholds([0.1, 0.25, 0.7, 0.9]);

    // Flatten spectrum for contour generation
    let flatSpectrum = [];
    for (let y = 0; y < specHeight; y++) {
      for (let x = 0; x < specWidth; x++) {
        flatSpectrum.push(Math.abs(spectrum[y][x]));
      }
    }

    // Normalize spectrum
    const maxVal = d3.max(flatSpectrum);
    const normalized = flatSpectrum.map((v) => v / maxVal);

    const contours = contourGenerator(normalized);

    // Scales for mapping spectrum coordinates to plot coordinates
    // Map from spectrum pixel coords to ppm values
    // Map from spectrum pixel coords to ppm values (correct axes)
    const specXScale = d3
      .scaleLinear()
      .domain([0, specWidth])
      .range([xLimits.max, xLimits.min]);

    const specYScale = d3
      .scaleLinear()
      .domain([0, specHeight])
      .range([yLimits.max, yLimits.min]);

    // Draw contours using geoPath with a custom projection that maps
    // contour coordinates (spectrum pixel coords) -> ppm -> screen coords
    console.log("contours count:", contours.length);

    const projection = d3.geoTransform({
      point: function (x, y) {
        // x,y are contour coordinates in pixel space
        const px = xScale(specXScale(x));
        const py = yScale(specYScale(y));
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
  })
  .catch((error) => {
    console.error("Error loading data:", error);
    d3.select("#plot-container")
      .append("p")
      .style("color", "red")
      .text("Error loading data: " + error);
  });
