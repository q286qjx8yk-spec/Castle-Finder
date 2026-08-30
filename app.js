// Castle Finder -- app.js
// Loads castle data, initializes the Leaflet map, and renders every castle
// as a clustered marker with a popup. Later phases (search/filter/trip
// planner) extend window.CastleApp rather than redeclaring it.

window.CastleApp = window.CastleApp || {};
window.CastleApp.castles = window.CastleApp.castles || [];
window.CastleApp.filtered = window.CastleApp.filtered || [];
window.CastleApp.map = window.CastleApp.map || null;
window.CastleApp.markerClusterGroup = window.CastleApp.markerClusterGroup || null;
window.CastleApp.markersById = window.CastleApp.markersById || new Map();

(function () {
  "use strict";

  var COUNTRY_COLORS = {
    "England": "#b3432d",
    "Scotland": "#3d5a80",
    "Wales": "#c98a1f",
    "Northern Ireland": "#4c7a52"
  };

  var DEFAULT_MARKER_COLOR = "#6e6455";

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function truncate(str, maxLen) {
    if (!str) return "";
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen).trim() + "…";
  }

  function buildPopupHtml(castle) {
    var parts = [];
    parts.push('<div class="castle-popup">');

    if (castle.image) {
      parts.push(
        '<img src="' + escapeHtml(castle.image) + '" alt="' +
        escapeHtml(castle.name) + '" loading="lazy">'
      );
    }

    parts.push('<div class="castle-popup-body">');
    parts.push('<h3>' + escapeHtml(castle.name) + '</h3>');

    var metaBits = [castle.country, castle.condition];
    if (castle.built) metaBits.push(castle.built);
    parts.push('<div class="castle-meta">' + escapeHtml(metaBits.join(" · ")) + '</div>');

    if (castle.heritageDesignation) {
      parts.push('<div class="castle-heritage">' + escapeHtml(castle.heritageDesignation) + '</div>');
    }

    if (castle.managedBy) {
      parts.push('<span class="castle-badge">' + escapeHtml(castle.managedBy) + '</span>');
    }

    if (castle.description) {
      parts.push('<div class="castle-description">' + escapeHtml(truncate(castle.description, 150)) + '</div>');
    }

    if (castle.wikipedia) {
      parts.push(
        '<a class="castle-wikipedia-link" href="' + escapeHtml(castle.wikipedia) +
        '" target="_blank" rel="noopener">View on Wikipedia</a>'
      );
    }

    parts.push('<div class="castle-popup-actions">');
    parts.push(
      '<button type="button" class="btn-add-trip" data-castle-id="' +
      escapeHtml(castle.id) + '">+ Add to Trip</button>'
    );
    parts.push(
      '<button type="button" class="btn-visited" data-castle-id="' +
      escapeHtml(castle.id) + '">Mark Visited</button>'
    );
    parts.push('</div>');

    parts.push('</div>'); // castle-popup-body
    parts.push('</div>'); // castle-popup

    return parts.join("");
  }

  // Builds a teardrop-pin divIcon in the given color. Exposed on
  // window.CastleApp so trip.js can regenerate a marker's icon (e.g. to
  // grey it out when marked visited) without duplicating the SVG template.
  function makePinIcon(color) {
    var svg =
      '<span class="castle-pin-inner">' +
      '<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21C26 5.8 20.2 0 13 0z" fill="' +
      color + '"/>' +
      '<circle cx="13" cy="13" r="5.5" fill="#ffffff"/>' +
      "</svg></span>";
    return L.divIcon({
      html: svg,
      className: "castle-pin-icon",
      iconSize: [26, 34],
      iconAnchor: [13, 34],
      popupAnchor: [0, -30]
    });
  }

  window.CastleApp.makePinIcon = makePinIcon;

  function createMarker(castle) {
    var color = COUNTRY_COLORS[castle.country] || DEFAULT_MARKER_COLOR;
    var marker = L.marker([castle.lat, castle.lon], {
      icon: makePinIcon(color),
      countryColor: color
    });
    marker.bindPopup(buildPopupHtml(castle));
    return marker;
  }

  function updateResultsCount(shown, total) {
    var el = document.getElementById("results-count");
    if (el) {
      el.textContent = "Showing " + shown + " of " + total + " castles";
    }
  }

  // Renders the given list of castles onto the marker cluster group,
  // clearing whatever is currently on it first. Later phases (filters)
  // call this again with a filtered subset.
  function renderCastles(castles) {
    var app = window.CastleApp;
    app.markerClusterGroup.clearLayers();
    app.markersById.clear();

    castles.forEach(function (castle) {
      var marker = createMarker(castle);
      app.markersById.set(castle.id, marker);
      app.markerClusterGroup.addLayer(marker);
    });

    updateResultsCount(castles.length, app.castles.length);
  }

  window.CastleApp.renderCastles = renderCastles;

  // ---------- Search & filtering ----------

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  }

  function getCheckedAttrValues(containerId, attr) {
    var container = document.getElementById(containerId);
    var values = [];
    if (!container) return values;
    container.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) {
      values.push(cb.getAttribute(attr));
    });
    return values;
  }

  // Recomputes the filtered castle list from the current state of the
  // search box and every filter checkbox, then re-renders the marker
  // cluster group by reusing the marker objects already in markersById
  // (built once at load time) rather than recreating them.
  function applyFilters() {
    var app = window.CastleApp;

    var searchInput = document.getElementById("search-input");
    var query = searchInput ? searchInput.value.trim().toLowerCase() : "";

    var countrySet = new Set(getCheckedAttrValues("filter-country", "data-country"));
    var conditionSet = new Set(getCheckedAttrValues("filter-condition", "data-condition"));
    var managedSet = new Set(getCheckedAttrValues("filter-managed", "data-managed"));

    var notableToggle = document.getElementById("notable-toggle");
    var notableOnly = notableToggle ? notableToggle.checked : false;

    var filtered = app.castles.filter(function (castle) {
      if (query && castle.name.toLowerCase().indexOf(query) === -1) return false;
      if (!countrySet.has(castle.country)) return false;
      if (!conditionSet.has(castle.condition)) return false;

      var managedKey = castle.managedBy ? castle.managedBy : "null";
      if (!managedSet.has(managedKey)) return false;

      if (notableOnly && !castle.image) return false;

      return true;
    });

    app.filtered = filtered;

    app.markerClusterGroup.clearLayers();
    filtered.forEach(function (castle) {
      var marker = app.markersById.get(castle.id);
      if (marker) app.markerClusterGroup.addLayer(marker);
    });

    updateResultsCount(filtered.length, app.castles.length);
  }

  window.CastleApp.applyFilters = applyFilters;

  function wireFilterControls() {
    var searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.addEventListener("input", debounce(function () {
        window.CastleApp.applyFilters();
      }, 150));
    }

    ["filter-country", "filter-condition", "filter-managed"].forEach(function (containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;
      container.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener("change", function () {
          window.CastleApp.applyFilters();
        });
      });
    });

    var notableToggle = document.getElementById("notable-toggle");
    if (notableToggle) {
      notableToggle.addEventListener("change", function () {
        window.CastleApp.applyFilters();
      });
    }
  }

  function initMap() {
    var map = L.map("map", {
      center: [54.5, -3.5],
      zoom: 6,
      minZoom: 5
    });

    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "&copy; <a href=\"https://www.esri.com\">Esri</a> &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS",
      maxZoom: 16
    }).addTo(map);

    window.CastleApp.map = map;

    var markerClusterGroup = L.markerClusterGroup();
    markerClusterGroup.addTo(map);
    window.CastleApp.markerClusterGroup = markerClusterGroup;
  }

  function init() {
    initMap();
    wireFilterControls();
    wireSidebarToggle();

    fetch("data/castles.json")
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load castles.json: " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        window.CastleApp.castles = data;

        // Build every marker once up front and index it by castle id.
        // applyFilters() reuses these objects on the cluster group rather
        // than recreating them on every search keystroke or filter toggle.
        data.forEach(function (castle) {
          var marker = createMarker(castle);
          window.CastleApp.markersById.set(castle.id, marker);
        });

        window.CastleApp.applyFilters();
      })
      .catch(function (err) {
        console.error("Castle Finder: failed to load castle data", err);
        var el = document.getElementById("results-count");
        if (el) el.textContent = "Failed to load castle data.";
      });
  }

  function wireSidebarToggle() {
    var toggle = document.getElementById("sidebar-toggle");
    var sidebar = document.getElementById("sidebar");
    if (!toggle || !sidebar) return;
    toggle.addEventListener("click", function () {
      sidebar.classList.toggle("sidebar-open");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ---------- Service worker registration ----------
  // Registered on window load so it doesn't compete with initial page
  // load, and guarded so a failure (e.g. running from file://, or no
  // browser support) never throws or breaks the rest of the app.
  window.addEventListener("load", function () {
    if ("serviceWorker" in navigator) {
      try {
        navigator.serviceWorker.register("sw.js").catch(function (err) {
          console.warn("Castle Finder: service worker registration failed", err);
        });
      } catch (err) {
        console.warn("Castle Finder: service worker registration failed", err);
      }
    }
  });
})();
