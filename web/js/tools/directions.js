(function (Q, $, window, undefined) {

var Places = Q.Places;
var Streams = Q.Streams;

/**
 * @module Places-tools
 */

/**
 * Renders a directions card using Google Maps Embed API iframe and/or
 * Apple Maps embed, with launch buttons to open native maps navigation.
 *
 * No JavaScript Maps API required — uses the simpler Embed API iframes
 * which work with just an embed key and stretch 100% to fill the tool.
 *
 * IMPORTANT: this tool should only be instantiated AFTER the destination
 * has been resolved by the AI pipeline with the requesting user's access
 * level checked. The stream attributes carry resolved coordinates, not a
 * reference to the private location stream — Bob's home address is embedded
 * at creation time by the host's authorized pipeline. The guest never sees
 * the Places/user/location/home stream itself.
 *
 * Stream attributes (Media/card/map stream):
 *   destination     — address or "lat,lng"
 *   destinationName — human readable e.g. "Bob's house"
 *   origin          — address, "lat,lng", or "current" (geolocation)
 *   lat, lng        — resolved destination coordinates (set by AI pipeline)
 *   mode            — driving | walking | transit | bicycling
 *   zoom            — integer (default 14)
 *   showGoogle      — true/false
 *   showApple       — true/false
 *   showButtons     — true/false (launch buttons)
 *
 * PHP/server usage — only create this stream if access check passes:
 *   $homeStream = Streams_Stream::fetch($hostUserId, $bobUserId, 'Places/user/location/home');
 *   if (!$homeStream || !$homeStream->testReadLevel('content')) {
 *       // Return access denied — do not create card stream
 *   }
 *   // Access OK — embed resolved coords in card stream
 *   $cardStream = Streams::create($hostUserId, array(
 *       'type' => 'Media/card/map',
 *       'attributes' => array(
 *           'destinationName' => "Bob's house",
 *           'lat'  => $homeStream->getAttribute('latitude'),
 *           'lng'  => $homeStream->getAttribute('longitude'),
 *           'mode' => 'driving'
 *       )
 *   ));
 *
 * @class Places/directions
 * @constructor
 * @param {Object} [options]
 * @param {String} [options.publisherId]
 * @param {String} [options.streamName]
 * @param {String} [options.destination]
 * @param {String} [options.destinationName]
 * @param {String} [options.origin='current']
 * @param {Number} [options.lat]
 * @param {Number} [options.lng]
 * @param {String} [options.mode='driving']
 * @param {Number} [options.zoom=14]
 * @param {Boolean}[options.showGoogle=true]
 * @param {Boolean}[options.showApple=true]
 * @param {Boolean}[options.showButtons=true]
 * @param {String} [options.googleEmbedKey]
 * @param {Q.Event}[options.onReady]
 */
Q.Tool.define("Places/directions", function (options) {
    var tool = this;
    var state = tool.state;

    if (state.publisherId && state.streamName) {
        Streams.retainWith(tool).get(state.publisherId, state.streamName,
        function (err, stream) {
            if (err) return;
            var a = stream.getAllAttributes();
            if (a.destination)     state.destination     = a.destination;
            if (a.destinationName) state.destinationName = a.destinationName;
            if (a.origin)          state.origin          = a.origin;
            if (a.lat)             state.lat             = parseFloat(a.lat);
            if (a.lng)             state.lng             = parseFloat(a.lng);
            if (a.mode)            state.mode            = a.mode;
            if (a.zoom)            state.zoom            = parseInt(a.zoom, 10);
            if (a.showGoogle  != null) state.showGoogle  = (a.showGoogle  !== 'false');
            if (a.showApple   != null) state.showApple   = (a.showApple   !== 'false');
            if (a.showButtons != null) state.showButtons = (a.showButtons !== 'false');

            // Zoom ephemeral — reload iframe with new zoom
            stream.onEphemeral('Streams/zoom').set(function (e) {
                var z = Math.round(state.zoom * e.scale);
                state.zoom = Math.max(8, Math.min(20, z));
                if (tool._googleIframe) tool._googleIframe.src = tool._googleEmbedUrl();
            }, tool);

            tool._render();
        });
    } else {
        tool._render();
    }
},
{
    publisherId:     null,
    streamName:      null,
    destination:     '',
    destinationName: '',
    origin:          'current',
    lat:             null,
    lng:             null,
    mode:            'driving',
    zoom:            14,
    showGoogle:      true,
    showApple:       true,
    showButtons:     true,
    googleEmbedKey:  null,
    onReady:         new Q.Event()
},
{
    _render: function () {
        var tool = this;
        var state = tool.state;
        if (!state.destination && !state.lat) return;

        // If origin is 'current', request geolocation then build
        if (state.origin === 'current' && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(function (pos) {
                state._originLL = pos.coords.latitude + ',' + pos.coords.longitude;
                tool._build();
            }, function () {
                state._originLL = null;
                tool._build();
            }, { timeout: 5000, maximumAge: 60000 });
        } else {
            state._originLL = (state.origin && state.origin !== 'current')
                ? state.origin : null;
            tool._build();
        }
    },

    _build: function () {
        var tool = this;
        var state = tool.state;
        var el = tool.element;
        el.innerHTML = '';

        // ── Header ────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'Places_directions_header';
        var name = document.createElement('div');
        name.className = 'Places_directions_name';
        name.textContent = state.destinationName || state.destination;
        var modeEl = document.createElement('div');
        modeEl.className = 'Places_directions_mode';
        var icons = { driving:'🚗', walking:'🚶', transit:'🚌', bicycling:'🚲' };
        modeEl.textContent = (icons[state.mode] || '📍') + ' ' + state.mode;
        header.appendChild(name);
        header.appendChild(modeEl);
        el.appendChild(header);

        // ── Google Maps Embed iframe ──────────────────────────────────
        if (state.showGoogle) {
            var gWrap = document.createElement('div');
            gWrap.className = 'Places_directions_embed';
            tool._googleIframe = document.createElement('iframe');
            tool._googleIframe.className = 'Places_directions_iframe';
            tool._googleIframe.setAttribute('allowfullscreen', '');
            tool._googleIframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
            tool._googleIframe.setAttribute('loading', 'lazy');
            tool._googleIframe.setAttribute('title', 'Directions to ' + (state.destinationName || state.destination));
            tool._googleIframe.src = tool._googleEmbedUrl();
            tool._googleIframe.addEventListener('load', function () {
                tool._googleIframe.classList.add('Places_directions_iframe_loaded');
            });
            gWrap.appendChild(tool._googleIframe);
            el.appendChild(gWrap);
        }

        // ── Apple Maps embed ─────────────────────────────────────────
        // Show on Apple platforms; also show if Google is off
        if (state.showApple && (!state.showGoogle || _isApple())) {
            var aWrap = document.createElement('div');
            aWrap.className = 'Places_directions_embed';
            var aFrame = document.createElement('iframe');
            aFrame.className = 'Places_directions_iframe';
            aFrame.setAttribute('allow', 'geolocation');
            aFrame.setAttribute('title', 'Apple Maps directions');
            aFrame.src = tool._appleEmbedUrl();
            aWrap.appendChild(aFrame);
            el.appendChild(aWrap);
        }

        // ── Launch buttons ───────────────────────────────────────────
        if (state.showButtons) {
            var row = document.createElement('div');
            row.className = 'Places_directions_buttons';

            if (state.showGoogle) {
                var gBtn = _makeButton(
                    'Open in Google Maps',
                    tool._googleNavUrl(),
                    'Places_directions_btn_google',
                    // Google Maps "G" mark SVG
                    '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>'
                );
                row.appendChild(gBtn);
            }

            if (state.showApple) {
                var aBtn = _makeButton(
                    'Open in Apple Maps',
                    tool._appleNavUrl(),
                    'Places_directions_btn_apple',
                    '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>'
                );
                row.appendChild(aBtn);
            }

            el.appendChild(row);
        }

        Q.handle(state.onReady, tool);
    },

    // Google Maps Embed API — iframe embed, requires embed key
    // https://developers.google.com/maps/documentation/embed/embedding-map
    _googleEmbedUrl: function () {
        var s = this.state;
        var key = s.googleEmbedKey
            || (Q.Config && Q.Config.get(['Places', 'google', 'embedKey'], null))
            || (Q.Config && Q.Config.get(['Places', 'google', 'apiKey'], null))
            || '';
        var dest = (s.lat && s.lng) ? (s.lat + ',' + s.lng) : s.destination;
        var origin = s._originLL || '';
        var modeMap = { driving:'driving', walking:'walking', transit:'transit', bicycling:'bicycling' };
        return 'https://www.google.com/maps/embed/v1/directions'
            + '?key=' + encodeURIComponent(key)
            + '&destination=' + encodeURIComponent(dest)
            + (origin ? '&origin=' + encodeURIComponent(origin) : '')
            + '&mode=' + (modeMap[s.mode] || 'driving')
            + '&zoom=' + s.zoom;
    },

    // Apple Maps embed iframe
    // https://developer.apple.com/maps/web/
    _appleEmbedUrl: function () {
        var s = this.state;
        var dest = (s.lat && s.lng) ? (s.lat + ',' + s.lng) : s.destination;
        // Apple Maps web in iframe: works on iOS/macOS Safari.
        // No special embed param needed — the URL opens the interactive map.
        // On non-Apple platforms, only the Google iframe shows (see _build).
        return 'https://maps.apple.com/?daddr=' + encodeURIComponent(dest)
            + (s._originLL ? '&saddr=' + encodeURIComponent(s._originLL) : '')
            + '&dirflg=' + _appleMode(s.mode)
            + '&t=m&z=' + s.zoom;
    },

    // Google Maps navigation URL (opens in app or browser)
    _googleNavUrl: function () {
        var s = this.state;
        var dest = (s.lat && s.lng) ? (s.lat + ',' + s.lng) : s.destination;
        var modeMap = { driving:'driving', walking:'walking', transit:'transit', bicycling:'bicycling' };
        return 'https://www.google.com/maps/dir/?api=1'
            + '&destination=' + encodeURIComponent(dest)
            + (s._originLL ? '&origin=' + encodeURIComponent(s._originLL) : '')
            + '&travelmode=' + (modeMap[s.mode] || 'driving');
    },

    // Apple Maps navigation URL
    _appleNavUrl: function () {
        var s = this.state;
        var dest = (s.lat && s.lng) ? (s.lat + ',' + s.lng) : s.destination;
        return 'https://maps.apple.com/?daddr=' + encodeURIComponent(dest)
            + (s._originLL ? '&saddr=' + encodeURIComponent(s._originLL) : '')
            + '&dirflg=' + _appleMode(s.mode);
    }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _appleMode(mode) {
    return { driving:'d', walking:'w', transit:'r', bicycling:'b' }[mode] || 'd';
}

function _isApple() {
    return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
}

function _makeButton(label, href, cls, iconSVG) {
    var a = document.createElement('a');
    a.className = 'Places_directions_btn ' + cls;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = iconSVG + ' ' + label;
    return a;
}

// ── Places.loadAppleMaps ─────────────────────────────────────────────────────
// MERGE into Places/web/js/Places.js alongside loadGoogleMaps
// Requires a MapKit JS authorization token (JWT from your server)

if (Q.Places && !Q.Places.loadAppleMaps) {
    /**
     * Load Apple MapKit JS before using advanced Apple Maps features.
     * For basic embed iframes, this is NOT required — the iframe src works
     * without MapKit JS. Use this only for interactive map instances.
     *
     * @method Places.loadAppleMaps
     * @static
     * @param {String} token     MapKit JS JWT token from your server
     * @param {Function} callback Called once mapkit is initialized
     */
    Q.Places.loadAppleMaps = function (token, callback) {
        if (window.mapkit && window.mapkit.Map) {
            callback();
            return;
        }
        Q.addScript('https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js', function () {
            mapkit.init({
                authorizationCallback: function (done) { done(token); }
            });
            callback();
        });
    };
    Q.Places.loadAppleMaps.waitingCallbacks = [];
}

// Register in Places.js Q.Tool.define block:
// "Places/directions": {
//     js:  "{{Places}}/js/tools/directions.js",
//     css: "{{Places}}/css/tools/directions.css"
// }
//
// Register in Media.patch.js displayTools:
// 'Media/card/map': 'Places/directions'

})(Q, Q.jQuery, window);
