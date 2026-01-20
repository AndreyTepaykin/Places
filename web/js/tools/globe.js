(function (Q, window, document, undefined) {

var Places = Q.Places;

/**
 * Places Tools
 * @module Places-tools
 */

/**
 * Displays a globe, using planetary.js
 * @class Places globe
 * @constructor
 * @param {Object} [options] used to pass options
 * @param {Object} [options.center] the initial coordinates to rotate to
 * @param {Number} [options.center.latitude] the initial latitude to rotate to
 * @param {Number} [options.center.longitude] the initial longitude to rotate to
 * @param {String} [options.countryCode=null] the initial country to rotate to and highlight
 * @param {String} [options.rotateOnClick=null] whether to handle clicks and rotate the globe when they happen
 * @param {Array} [options.highlight={}] pairs of {countryCode: color},
 *   if color is true then state.colors.highlight is used.
 *   This is modified by the default handler for beforeRotateToCountry added by this tool.
 * @param {Number} [options.radius=0.9] The radius of the globe, as a fraction of Math.min(canvas.width, canvas.height) / 2.
 * @param {Number} [options.durations] The duration of rotation animation (it all rhymes baby)
 * @param {Object} [options.colors] colors for the planet
 * @param {String} [options.colors.oceans='#2a357d'] the color of the ocean
 * @param {String} [options.colors.land='#389631'] the color of the land
 * @param {String} [options.colors.borders='#008000'] the color of the borders
 * @param {Object} [options.pings] default options for any pings added with addPing
 * @param {Object} [options.pings.duration=2000] default duration of any ping animation
 * @param {Object} [options.pings.size=10] default size of any ping animation
 * @param {Object} [options.pings.color='white'] default color of any ping animation
 * @param {Object} [options.shadow] shadow effect configuration
 * @param {String} [options.shadow.src="{{Q}}/img/shadow3d.png"] src , path to image
 * @param {Number} [options.shadow.stretch=1.5] stretch
 * @param {Number} [options.shadow.dip=0.25] dip
 * @param {Number} [options.shadow.opacity=0.5] opacity
 * @param {Q.Event} [options.onReady] this event occurs when the globe is ready
 * @param {Q.Event} [options.onSelect] this event occurs when the user has selected a country or a place on the globe. It is passed (latitude, longitude, countryCode)
 * @param {Q.Event} [options.beforeRotate] this event occurs right before the globe is about to rotate to some location
 * @param {Q.Event} [options.beforeRotateToCountry] this event occurs right before the globe is about to rotate to some country
 */
Q.Tool.define("Places/globe", function _Places_globe(options) {
	var tool = this;
	var state = tool.state;
	var el = tool.element;
	
	var p = Q.pipe(['scripts', 'countries'], function _proceed() {
		tool.canvas = Q.element("canvas", {
			width: el.clientWidth,
			height: el.clientHeight
		});
		el.appendChild(tool.canvas);
		
		// local mapping topojsonId -> alpha2
		var topoIdToAlpha2 = {};
		Q.each(Places.countries, function(alpha2, arr) {
			topoIdToAlpha2[arr[2]] = alpha2;
		});

		if (state.rotateOnClick) {
			Q.addEventListener(tool.canvas, Q.Pointer.fastclick, function(event) {
				var ll = tool.getCoordinates(event);
				var countryCode = _latLngToCountryCode(ll.latitude, ll.longitude, tool.globe, topoIdToAlpha2);
				if (countryCode) {
					tool.rotateToCountry(countryCode);
				} else {
					tool.rotateTo(ll.latitude, ll.longitude);
				}
				Q.handle(state.onSelect, [ll.latitude, ll.longitude, countryCode]);
			});
		}
		
		if (!state.radius) {
			state.radius = 0.9;
		}
		
		var globe = tool.globe = planetaryjs.planet();
		
		globe.onInit(function () {
			(function waitForTopojson() {
				var tj = globe.plugins.topojson;
				if (tj && tj.world) {
					Q.handle(state.onReady, tool);
				} else {
					setTimeout(waitForTopojson, 100);
				}
			})();
		});
		
		// The `earth` plugin draws the oceans and the land; it's actually
		// a combination of several separate built-in plugins.
		globe.loadPlugin(planetaryjs.plugins.earth({
			topojson: { file: Q.url('{{Places}}/data/world-110m-withlakes.json') },
			oceans:   { fill: state.colors.oceans },
			land:     { fill: state.colors.land },
			borders:  { stroke: state.colors.borders }
		}));
		
		// Load our custom `lakes` plugin to draw lakes
		globe.loadPlugin(_lakes({ fill: state.colors.oceans }));
		
		// Load our custom `highlight` plugin to highlight countries
		globe.loadPlugin(_highlight({ tool: tool }));
		
		// The zoom and drag plugins enable manipulating the globe with the mouse.
		var half = Math.min(tool.canvas.width, tool.canvas.height) / 2;
		var radius = half * state.radius;
		globe.loadPlugin(planetaryjs.plugins.zoom({
			scaleExtent: [radius, 20 * state.radius]
		}));
		globe.loadPlugin(planetaryjs.plugins.drag({
			afterDrag: function(planet) {
				var r = this.projection.rotate();
				tool.state.center = {
					longitude: -r[0],
					latitude: -r[1]
				};
			}
		}));
		
		// Set up the globe's initial scale, offset, and rotation.
		globe.projection
			.scale(radius)
			.translate([half, half])
			.rotate([0, -10, 0]);
		
		globe.loadPlugin(planetaryjs.plugins.pings());
		
		if (state.shadow && state.shadow.src) {
			var shadow = Q.element("img", {
				src: Q.url(state.shadow.src),
				'class': "Places_globe_shadow"
			});
			shadow.style.display = "none";
			el.insertBefore(shadow, el.firstChild);
			Q.addEventListener(shadow, "load", function () {
				var w = radius * 2;
				var width = w * state.shadow.stretch;
				var height = Math.min(
					shadow.naturalHeight * width / shadow.naturalWidth,
					w / 2
				);
				Object.assign(shadow.style, {
					position: "absolute",
					left: (el.clientWidth - width)/2 + "px",
					top: el.clientHeight - height * (1 - state.shadow.dip) + "px",
					width: width + "px",
					height: height + "px",
					opacity: state.shadow.opacity,
					display: "",
					zIndex: 1
				});
			});
			var placeholder = Q.element("div", { 'class': "Places_globe_placeholder" });
			placeholder.style.width = tool.canvas.width + "px";
			placeholder.style.height = tool.canvas.height + "px";
			el.insertBefore(placeholder, tool.canvas.nextSibling);
			Object.assign(tool.canvas.style, {
				position: "absolute",
				top: 0,
				left: 0,
				zIndex: 2
			});
			if (getComputedStyle(el).position === "static") {
				el.style.position = "relative";
			}
		}
		
		el.addEventListener("touchmove", function (e) {
			e.preventDefault();
		});
		
		tool.refresh();
	});
	
	Q.addScript([
		'{{Places}}/js/lib/d3.js',
		'{{Places}}/js/lib/topojson.js',
		'{{Places}}/js/lib/planetaryjs.js'
	], p.fill('scripts'));
	
	Places.loadCountries(p.fill('countries'));
},

{ // default options here
	countryCode: null,
	rotateOnClick: false,
	colors: {
		oceans: '#2a357d',
		land: '#389631',
		borders: '#008000',
		highlight: '#ff0000'
	},
	center: {
		latitude: 0,
		longitude: 0
	},
	highlight: {},
	radius: null,
	duration: 1000,
	pings: {
		duration: 2000,
		size: 10,
		color: 'white'
	},
	shadow: {
		src: "{{Q}}/img/shadow3d.png",
		stretch: 1.2,
		dip: 0.25,
		opacity: 0.5
	},
	onReady: new Q.Event(),
	onRefresh: new Q.Event(),
	beforeRotate: new Q.Event(),
	beforeRotateToCountry: new Q.Event(function (countryCode) {
		var h = this.state.highlight = {};
		h[countryCode] = true;
	}, "Place/globe"),
	onRotateEnded: new Q.Event()
},

{ // methods go here
	
	refresh: function _Places_globe_refresh () {
		var tool = this;
		var state = tool.state;
		tool.globe.draw(tool.canvas);
		var waitForTopoJsonLoad = setInterval(_a, 50);
		function _a() {
			if (!Q.getObject('globe.plugins.topojson.world', tool)) return;
			if (state.countryCode) {
				tool.rotateToCountry(state.countryCode, 0);	
			} else if (state.center) {
				tool.rotateTo(state.center.latitude, state.center.longitude, 0);
			}
			clearInterval(waitForTopoJsonLoad);
			Q.handle(state.onRefresh, tool);
		}
		_a();
	},
	
	countryCenter: function Places_globe_countryCenter (countryCode) {
		var feature = _getFeature(this.globe, countryCode);
		if (!feature) return false;
		var p = d3.geo.centroid(feature);
		return { latitude: p[0], longitude: p[1] };
	},
	
	rotateTo: Q.preventRecursion('Places/globe rotateTo', 
	function Places_globe_rotateTo (latitude, longitude, duration, callback) {
		var tool = this;
		if (duration == null) duration = tool.state.duration;
		var projection = tool.globe.projection;
		var c = tool.state.center;
		if (tool.animation) tool.animation.pause();
		if (duration === 0) {
			tool.state.center = { latitude: latitude, longitude: longitude };
			return projection.rotate([-longitude, -latitude]);
		}
		Q.handle(tool.state.beforeRotate, tool, [latitude, longitude, duration]);
		tool.animation = Q.Animation.play(function (x, y) {
			var latitude2 = c.latitude + (latitude - c.latitude) * y;
			var longitude2 = c.longitude + (longitude - c.longitude) * y;
			if (longitude2 < 180) longitude2 += 360;
			if (longitude2 > -180) longitude2 -= 360;
			projection.rotate([-longitude2, -latitude2]);
			tool.state.center = { latitude: latitude, longitude: longitude };
		}, duration);
	}),
		
	rotateToCountry: Q.preventRecursion('Q/globe rotateToCountry',
	function(countryCode, duration) {
		var tool = this;
		var feature = _getFeature(tool.globe, countryCode);
		var coords;

		if (feature) {
		var p = d3.geo.centroid(feature);
		coords = { latitude: p[1], longitude: p[0] };
		} else if (fallbackCoords[countryCode]) {
		coords = fallbackCoords[countryCode];
		}

		if (!coords) return false;

		// Mark it for highlight
		tool.state.highlight[countryCode] = tool.state.colors.highlight;

		Q.handle(tool.state.beforeRotateToCountry, tool,
			   [countryCode, coords.latitude, coords.longitude, duration]);
		tool.rotateTo(coords.latitude, coords.longitude, duration);
		return true;
	}),

	getCoordinates: function Places_globe_getCoordinates(event) {
		var rect = event.target.getBoundingClientRect();
		var x = Q.Pointer.getX(event) - rect.left;
		var y = Q.Pointer.getY(event) - rect.top;
		var coordinates = this.globe.projection.invert([x, y]);
		return { latitude: coordinates[1], longitude: coordinates[0] };
	},
	
	addPing: function (latitude, longitude, duration, size, color) {
		var state = this.state;
		var globe = this.globe;
		if (!globe.plugins.pings) return;
		globe.plugins.pings.add(longitude, latitude, { 
			color: color || state.pings.color, 
			lineWidth: 2,
			ttl: duration || state.pings.duration, 
			angle: size || state.pings.size
		});
	},
	
	rotationSpeed: function (longitudeSpeed, fps) {
		var tool = this;
		if (tool.rotationInterval) clearInterval(tool.rotationInterval);
		if (!longitudeSpeed) return;
		fps = fps || 50;
		tool.rotationInterval = setInterval(function () {
			if (!tool.globe || !tool.state.center) return;
			var longitude = tool.state.center.longitude + (longitudeSpeed * fps / 1000);
			var ms = fps;
			if (longitude > 360 * 10000 + 180) longitude = longitude % 360 - 360;
			if (longitude < -360 * 10000 - 180) longitude = longitude % 360 + 360;
			tool.rotateTo(tool.state.center.latitude, longitude, ms);
		}, fps);
	},

	setCountryColor: function (countryCode, cssColor) {
		if (!countryCode) return;
		this.state.highlight[countryCode] = cssColor;
		this.globe.draw(this.canvas);
	},

	animateCountryColor: function (countryCode, cssColorFrom, cssColorTo, duration, ease) {
		var tool = this;
		if (!countryCode) return;

		function parseColor(c) {
			var ctx = document.createElement("canvas").getContext("2d");
			ctx.fillStyle = c;
			return ctx.fillStyle;
		}
		function toRGB(str) {
			var m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(str);
			return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : [0,0,0];
		}

		var from = toRGB(parseColor(cssColorFrom));
		var to = toRGB(parseColor(cssColorTo));

		Q.Animation.play(function (x, y) {
			var rgb = from.map(function (v, i) {
				return Math.round(v + (to[i] - v) * y);
			});
			var color = "rgb(" + rgb.join(",") + ")";
			tool.setCountryColor(countryCode, color);
		}, duration, ease || "smooth");
	},
	
	/**
	 * Adds random pings distributed among given countries, using actual
	 * TopoJSON country features from the Places.countries dataset.
	 *
	 * @method addRandomPings
	 * @param {Object} [options]
	 * @param {String[]} [options.countries] List of ISO country codes (default: all)
	 * @param {Number} [options.count=1000000] Number of pings (roughly “keep going”)
	 * @param {Number} [options.minDelay=100] Minimum delay between pings (ms)
	 * @param {Number} [options.maxDelay=600] Maximum delay between pings (ms)
	 * @param {Boolean|Number} [options.rotate=true] Whether to rotate toward each ping, and how fast
	 * @param {Boolean} [options.stopOnPointer=true] Stop rotation on pointer interaction
	 * @param {Function} [options.filter] Optional callback(countryCode, feature) => bool
	 * @param {Object} [options.prioritizeCountries] Map of countryCode to weight (0–10)
	 * @param {String} [options.initialCountry] Country code to show first ping in
	 */
	addRandomPings: function (options) {
		var o = Q.extend({
			countries: Object.keys(Places.countries || {}),
			count: 1000000,
			minDelay: 100,
			maxDelay: 600,
			rotate: false,
			stopOnPointer: true,
			filter: null,
			prioritizeCountries: {
				"initialCountry": 3
			},
			initialCountry: null
		}, options);

		var tool = this;
		tool.state.onReady.addOnce(function () {
			var globe = tool.globe;
			var ri = null;
			var features = {};

			// Pre-resolve valid features for faster sampling
			o.countries.forEach(function (code) {
				var f = _getFeature(globe, code);
				if (f && (!o.filter || o.filter(code, f))) {
					features[code] = f;
				}
			});

			var validCodes = Object.keys(features);
			if (!validCodes.length) return;
			
			if (o.prioritizeCountries && o.prioritizeCountries.initialCountry) {
				o.prioritizeCountries = o.prioritizeCountries || {};
				o.prioritizeCountries[o.initialCountry] = o.prioritizeCountries.initialCountry;
			}

			// Weighted sampling array
			var weightedCodes = [];
			validCodes.forEach(code => {
				var code2 = (code === 'initialCountry') ? o.initialCountry : code;
				var weight = Math.max(0, o.prioritizeCountries[code2] || 1);
				var repeat = Math.round(weight * 10); // scaling factor
				for (var i = 0; i < repeat; i++) weightedCodes.push(code);
			});
			if (!weightedCodes.length) weightedCodes.push(...validCodes);

			var remaining = o.count;

			function addPingInCountry(code) {
				var feature = features[code];
				if (!feature) return;
				var [lat, lon] = _randomPointInPolygon(feature);
				tool.addPing(lat, lon);

				// optional: rotate toward new ping
				if (o.rotate) {
					if (ri) clearInterval(ri);
					var speed = (o.rotate === true) ? 1 : o.rotate;
					ri = setInterval(function () {
						tool.rotateTo(lat, lon, minDelay / o.rotate);
					}, minDelay);
				}
			}

			// Initial ping, if requested
			if (o.initialCountry && features[o.initialCountry]) {
				addPingInCountry(o.initialCountry);
				remaining--;
			}

			// Continuous ping loop
			(function pingLoop() {
				if (!remaining--) return;
				var code = weightedCodes[Math.floor(Math.random() * weightedCodes.length)];
				addPingInCountry(code);
				setTimeout(
					pingLoop,
					Math.random() * (o.maxDelay - o.minDelay) + o.minDelay
				);
			})();

			// Stop rotation when user interacts
			if (o.stopOnPointer) {
				Q.addEventListener(tool.element, Q.Pointer.start, function () {
					if (ri) clearInterval(ri);
				});
			}
		});
	},

	Q: {
		beforeRemove: function () {
			clearInterval(this.rotationInterval);
		}
	}
	
});

function _lakes(options) {
	options = options || {};
	var lakes = null;
	return function(planet) {
		planet.onInit(function() {
			var world = planet.plugins.topojson.world;
			lakes = topojson.feature(world, world.objects.ne_110m_lakes);
		});
		planet.onDraw(function() {
			planet.withSavedContext(function(context) {
				context.beginPath();
				planet.path.context(context)(lakes);
				context.fillStyle = options.fill || 'black';
				context.fill();
			});
		});
	};
};

function _highlight(options) {
	var tool = options.tool;
	return function(planet) {
		planet.onDraw(function() {
		  planet.withSavedContext(function(context) {
		    Q.each(tool.state.highlight, function(countryCode, color) {
		      var feature = _getFeature(tool.globe, countryCode);
		      var c = tool.canvas.getContext("2d");
		      c.fillStyle = typeof color === 'string' ? color : tool.state.colors.highlight;

		      if (feature) {
		        var projection = tool.globe.projection;
		        var path = d3.geo.path().projection(projection).context(c);
		        c.beginPath();
		        path(feature);
		        c.fill();
		      } else if (fallbackCoords[countryCode]) {
		        var projection = tool.globe.projection;
		        var xy = projection([fallbackCoords[countryCode].longitude,
		                             fallbackCoords[countryCode].latitude]);
		        c.beginPath();
		        c.arc(xy[0], xy[1], 4, 0, 2 * Math.PI);
		        c.fill();
		      }
		    });
		  });
		});
	};
}

function _getFeature(planet, countryCode) {
	var parts = Places.countries[countryCode];
	if (!parts) return null;
	var lookup = parts[2];
	var tj = planet.plugins.topojson;
	if (!tj || !tj.world) return null;
	var countries = tj.world.objects.countries;
	var features = topojson.feature(tj.world, countries).features;
	var feature = null;
	Q.each(features, function () {
		if (this.id == lookup) feature = this;
	});
	return feature;
}

// helper: sample uniformly within polygon (simple bounding-box rejection)
function _randomPointInPolygon(feature) {
	var lonMin = Infinity, lonMax = -Infinity;
	var latMin = Infinity, latMax = -Infinity;

	// Compute bounding box manually
	var coords = feature.geometry.coordinates;
	var geomType = feature.geometry.type;

	function scanCoords(arr) {
		for (var i = 0; i < arr.length; i++) {
			var val = arr[i];
			if (Array.isArray(val[0])) {
				scanCoords(val); // recurse
			} else {
				var [lon, lat] = val;
				if (lon < lonMin) lonMin = lon;
				if (lon > lonMax) lonMax = lon;
				if (lat < latMin) latMin = lat;
				if (lat > latMax) latMax = lat;
			}
		}
	}

	scanCoords(coords);

	// Sample random point until inside polygon
	var lat, lon;
	do {
		lon = Math.random() * (lonMax - lonMin) + lonMin;
		lat = Math.random() * (latMax - latMin) + latMin;
	} while (!_geoContains(feature, [lon, lat]));

	return [lat, lon];
}


function _geoContains(feature, point) {
  switch (feature.type) {
    case "Feature":
      return _geoContains(feature.geometry, point);
    case "FeatureCollection":
      for (var i = 0; i < feature.features.length; i++) {
        if (_geoContains(feature.features[i].geometry, point)) return true;
      }
      return false;
    case "GeometryCollection":
      for (var i = 0; i < feature.geometries.length; i++) {
        if (_geoContains(feature.geometries[i], point)) return true;
      }
      return false;
    case "Polygon":
      return polygonContains(feature.coordinates, point);
    case "MultiPolygon":
      for (var i = 0; i < feature.coordinates.length; i++) {
        if (polygonContains(feature.coordinates[i], point)) return true;
      }
      return false;
    default:
      return false;
  }
}

function polygonContains(polygon, point) {
  var inside = ringContains(polygon[0], point);
  for (var i = 1; i < polygon.length; ++i) {
    if (ringContains(polygon[i], point)) inside = !inside;
  }
  return inside;
}

function ringContains(ring, point) {
  var lambda = point[0] * Math.PI / 180;
  var phi = point[1] * Math.PI / 180;
  var inside = false;

  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var lambda_i = ring[i][0] * Math.PI / 180;
    var phi_i = ring[i][1] * Math.PI / 180;
    var lambda_j = ring[j][0] * Math.PI / 180;
    var phi_j = ring[j][1] * Math.PI / 180;

    // test if the segment crosses the parallel at phi
    if ((phi_i > phi) !== (phi_j > phi)) {
      var intersect =
        (lambda_j - lambda_i) * (phi - phi_i) / (phi_j - phi_i) + lambda_i;
      if (intersect > lambda) inside = !inside;
    }
  }

  return inside;
}

function _latLngToCountryCode(lat, lng, globe, topoIdToAlpha2) {
	var tj = globe.plugins.topojson;
	if (!tj || !tj.world) return null;
	var features = topojson.feature(tj.world, tj.world.objects.countries).features;
	for (var i = 0; i < features.length; i++) {
		if (_geoContains(features[i], [lng, lat])) {
			return topoIdToAlpha2[features[i].id] || null;
		}
	}
	return null;
}

var fallbackCoords = {
  "AD": { latitude: 42.5078, longitude: 1.5211 },    // Andorra
  "AG": { latitude: 17.0608, longitude: -61.7964 },  // Antigua and Barbuda
  "AI": { latitude: 18.2206, longitude: -63.0686 },  // Anguilla
  "AW": { latitude: 12.5211, longitude: -69.9683 },  // Aruba
  "AX": { latitude: 60.1785, longitude: 19.9156 },   // Aland Islands
  "BB": { latitude: 13.1939, longitude: -59.5432 },  // Barbados
  "BH": { latitude: 26.0667, longitude: 50.5577 },   // Bahrain
  "BM": { latitude: 32.3078, longitude: -64.7505 },  // Bermuda
  "BN": { latitude: 4.5353, longitude: 114.7277 },   // Brunei
  "BQ": { latitude: 12.1784, longitude: -68.2385 },  // Bonaire
  "BT": { latitude: 27.5142, longitude: 90.4336 },   // Bhutan
  "BV": { latitude: -54.4208, longitude: 3.3464 },   // Bouvet Island
  "CV": { latitude: 15.1111, longitude: -23.6167 },  // Cape Verde
  "CW": { latitude: 12.1696, longitude: -68.9900 },  // Curaçao
  "DM": { latitude: 15.4150, longitude: -61.3710 },  // Dominica
  "FO": { latitude: 61.8926, longitude: -6.9118 },   // Faroe Islands
  "FM": { latitude: 6.8870, longitude: 158.2150 },   // Micronesia
  "GD": { latitude: 12.1165, longitude: -61.6790 },  // Grenada
  "GG": { latitude: 49.4657, longitude: -2.5853 },   // Guernsey
  "GI": { latitude: 36.1408, longitude: -5.3536 },   // Gibraltar
  "GL": { latitude: 71.7069, longitude: -42.6043 },  // Greenland
  "GP": { latitude: 16.2650, longitude: -61.5510 },  // Guadeloupe
  "GU": { latitude: 13.4443, longitude: 144.7937 },  // Guam
  "HK": { latitude: 22.3193, longitude: 114.1694 },  // Hong Kong
  "IM": { latitude: 54.2361, longitude: -4.5481 },   // Isle of Man
  "JE": { latitude: 49.2144, longitude: -2.1313 },   // Jersey
  "KI": { latitude: 1.8709, longitude: -157.3630 },  // Kiribati
  "KN": { latitude: 17.3578, longitude: -62.7830 },  // Saint Kitts and Nevis
  "KY": { latitude: 19.3133, longitude: -81.2546 },  // Cayman Islands
  "LC": { latitude: 13.9094, longitude: -60.9789 },  // Saint Lucia
  "LI": { latitude: 47.1660, longitude: 9.5554 },    // Liechtenstein
  "LS": { latitude: -29.6100, longitude: 28.2336 },  // Lesotho
  "LU": { latitude: 49.8153, longitude: 6.1296 },    // Luxembourg
  "MC": { latitude: 43.7384, longitude: 7.4246 },    // Monaco
  "MH": { latitude: 7.1315, longitude: 171.1845 },   // Marshall Islands
  "MQ": { latitude: 14.6415, longitude: -61.0242 },  // Martinique
  "MS": { latitude: 16.7425, longitude: -62.1874 },  // Montserrat
  "MT": { latitude: 35.9375, longitude: 14.3754 },   // Malta
  "MV": { latitude: 3.2028, longitude: 73.2207 },    // Maldives
  "NC": { latitude: -20.9043, longitude: 165.6180 }, // New Caledonia
  "NF": { latitude: -29.0408, longitude: 167.9547 }, // Norfolk Island
  "NR": { latitude: -0.5228, longitude: 166.9315 },  // Nauru
  "MP": { latitude: 15.0979, longitude: 145.6739 },  // Northern Mariana Islands
  "PN": { latitude: -24.7036, longitude: -127.4393 },// Pitcairn Islands
  "PW": { latitude: 7.5150, longitude: 134.5825 },   // Palau
  "RE": { latitude: -21.1151, longitude: 55.5364 },  // Réunion
  "SB": { latitude: -9.6457, longitude: 160.1562 },  // Solomon Islands
  "SC": { latitude: -4.6796, longitude: 55.4915 },   // Seychelles
  "SG": { latitude: 1.3521, longitude: 103.8198 },   // Singapore
  "SH": { latitude: -15.9650, longitude: -5.7089 },  // Saint Helena
  "SM": { latitude: 43.9336, longitude: 12.4508 },   // San Marino
  "ST": { latitude: 0.1864, longitude: 6.6131 },     // São Tomé and Príncipe
  "SX": { latitude: 18.0425, longitude: -63.0548 },  // Sint Maarten
  "TC": { latitude: 21.6940, longitude: -71.7979 },  // Turks and Caicos Islands
  "TF": { latitude: -49.2804, longitude: 69.3486 },  // French Southern Territories
  "TK": { latitude: -9.2002, longitude: -171.8484 }, // Tokelau
  "TO": { latitude: -21.1790, longitude: -175.1982 },// Tonga
  "TT": { latitude: 10.6918, longitude: -61.2225 },  // Trinidad and Tobago
  "TV": { latitude: -7.1095, longitude: 179.1940 },  // Tuvalu
  "UM": { latitude: 19.2800, longitude: 166.6000 },  // US Minor Outlying Islands
  "VC": { latitude: 12.9843, longitude: -61.2872 },  // Saint Vincent and the Grenadines
  "WF": { latitude: -13.7688, longitude: -177.1561 },// Wallis & Futuna
  "WS": { latitude: -13.7590, longitude: -172.1046 },// Samoa
  "AS": { latitude: -14.2710, longitude: -170.1322 },// American Samoa
  "YT": { latitude: -12.8275, longitude: 45.1662 },  // Mayotte
  "BL": { latitude: 17.9000, longitude: -62.8333 },  // Saint Barthélemy
  "MF": { latitude: 18.0708, longitude: -63.0501 },  // Saint Martin (French)
  "PM": { latitude: 46.8852, longitude: -56.3159 },  // Saint Pierre and Miquelon
  "GS": { latitude: -54.4296, longitude: -36.5879 }, // South Georgia & South Sandwich
  "SJ": { latitude: 78.0000, longitude: 20.0000 }    // Svalbard & Jan Mayen
};

})(Q, window, document);