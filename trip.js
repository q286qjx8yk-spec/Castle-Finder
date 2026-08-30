// Castle Finder -- trip.js
// Trip planner and visited-castle tracker. Extends window.CastleApp (never
// redeclares it). Depends on app.js having already run: it wraps
// window.CastleApp.applyFilters to learn when castle data has finished
// loading, and it reuses the marker objects app.js built in
// window.CastleApp.markersById.

window.CastleApp = window.CastleApp || {};
window.CastleApp.trip = window.CastleApp.trip || [];
window.CastleApp.visited = window.CastleApp.visited || new Set();

(function () {
  "use strict";

  var STORAGE_TRIP_KEY = "castlefinder_trip";
  var STORAGE_VISITED_KEY = "castlefinder_visited";

  var castlesById = {};
  var routeLine = null;
  var castlesLoadedHandled = false;

  // ---------- small helpers ----------

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getCssVar(name, fallback) {
    try {
      var val = getComputedStyle(document.documentElement).getPropertyValue(name);
      return val && val.trim() ? val.trim() : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // Great-circle distance between two lat/lon points, in kilometers.
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ---------- persistence ----------

  function saveTrip() {
    try {
      localStorage.setItem(STORAGE_TRIP_KEY, JSON.stringify(window.CastleApp.trip));
    } catch (e) {
      /* localStorage unavailable -- ignore */
    }
  }

  function saveVisited() {
    try {
      localStorage.setItem(STORAGE_VISITED_KEY, JSON.stringify(Array.from(window.CastleApp.visited)));
    } catch (e) {
      /* localStorage unavailable -- ignore */
    }
  }

  // ---------- castle indexing ----------

  function indexCastles() {
    castlesById = {};
    window.CastleApp.castles.forEach(function (castle) {
      castlesById[castle.id] = castle;
    });
  }

  // ---------- initial state (localStorage + ?trip= override) ----------

  function readJsonArray(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function loadInitialState() {
    var app = window.CastleApp;

    app.trip = readJsonArray(STORAGE_TRIP_KEY).filter(function (id) {
      return castlesById.hasOwnProperty(id);
    });
    app.visited = new Set(
      readJsonArray(STORAGE_VISITED_KEY).filter(function (id) {
        return castlesById.hasOwnProperty(id);
      })
    );

    try {
      var params = new URLSearchParams(location.search);
      var tripParam = params.get("trip");
      if (tripParam) {
        var ids = tripParam
          .split(",")
          .map(function (s) {
            return s.trim();
          })
          .filter(function (id) {
            return id && castlesById.hasOwnProperty(id);
          });
        app.trip = ids;
      }
    } catch (e) {
      /* ignore malformed query string */
    }

    saveTrip();
    saveVisited();
  }

  // ---------- marker styling ----------

  function restyleMarker(id, visited) {
    var marker = window.CastleApp.markersById.get(id);
    if (!marker || typeof window.CastleApp.makePinIcon !== "function") return;
    // marker.options.countryColor holds the original country color the
    // marker was created with (set once by app.js at creation time).
    var color = visited ? getCssVar("--text-muted", "#6e6455") : marker.options.countryColor;
    marker.setIcon(window.CastleApp.makePinIcon(color));
  }

  function applyVisitedStyles() {
    window.CastleApp.visited.forEach(function (id) {
      restyleMarker(id, true);
    });
  }

  // ---------- route line ----------

  function updateRouteLine() {
    var app = window.CastleApp;
    if (!app.map) return;

    if (routeLine) {
      app.map.removeLayer(routeLine);
      routeLine = null;
    }

    if (app.trip.length >= 2) {
      var latlngs = app.trip
        .map(function (id) {
          var c = castlesById[id];
          return c ? [c.lat, c.lon] : null;
        })
        .filter(function (pt) {
          return pt !== null;
        });

      if (latlngs.length >= 2) {
        routeLine = L.polyline(latlngs, {
          color: getCssVar("--accent", "#2dd4bf"),
          weight: 3,
          opacity: 0.85,
          dashArray: "6, 8"
        }).addTo(app.map);
      }
    }
  }

  // ---------- trip panel rendering ----------

  function renderTripPanel() {
    var app = window.CastleApp;
    var panel = document.getElementById("trip-panel");
    if (!panel) return;

    var count = app.trip.length;
    var html = [];

    html.push(
      '<h2 class="filter-group-title">Trip Planner — ' +
        count +
        (count === 1 ? " castle" : " castles") +
        "</h2>"
    );

    if (count > 0) {
      html.push('<ol class="trip-list">');
      app.trip.forEach(function (id) {
        var castle = castlesById[id];
        var name = castle ? castle.name : id;
        html.push('<li class="trip-list-row">');
        html.push('<span class="trip-list-name">' + escapeHtml(name) + "</span>");
        html.push(
          '<button type="button" class="btn-trip-remove" data-castle-id="' +
            escapeHtml(id) +
            '" title="Remove from trip" aria-label="Remove ' +
            escapeHtml(name) +
            ' from trip">&times;</button>'
        );
        html.push("</li>");
      });
      html.push("</ol>");
    } else {
      html.push('<div class="trip-empty">No castles added yet. Use “+ Add to Trip” on a castle popup.</div>');
    }

    html.push('<div class="trip-actions">');
    html.push('<button type="button" id="btn-optimize-route" class="trip-action-btn">Optimize Route</button>');
    html.push('<button type="button" id="btn-clear-trip" class="trip-action-btn">Clear Trip</button>');
    html.push('<button type="button" id="btn-share-trip" class="trip-action-btn">Share Trip</button>');
    html.push("</div>");

    html.push(
      '<div class="trip-stat">Visited ' + app.visited.size + " of " + app.castles.length + " castles</div>"
    );

    panel.innerHTML = html.join("");
  }

  // ---------- toggling trip / visited membership ----------

  function toggleTrip(id) {
    var app = window.CastleApp;
    var idx = app.trip.indexOf(id);
    if (idx === -1) {
      app.trip.push(id);
    } else {
      app.trip.splice(idx, 1);
    }
    saveTrip();
    renderTripPanel();
    updateRouteLine();
  }

  function toggleVisited(id) {
    var app = window.CastleApp;
    if (app.visited.has(id)) {
      app.visited.delete(id);
      restyleMarker(id, false);
    } else {
      app.visited.add(id);
      restyleMarker(id, true);
    }
    saveVisited();
    renderTripPanel();
  }

  // ---------- popup button text ----------

  function updateAddTripButtonText(btn, inTrip) {
    btn.textContent = inTrip ? "✓ In Trip (remove)" : "+ Add to Trip";
    btn.classList.toggle("is-active", inTrip);
  }

  function updateVisitedButtonText(btn, visited) {
    btn.textContent = visited ? "✓ Visited" : "Mark Visited";
    btn.classList.toggle("is-active", visited);
  }

  function syncPopupButtons(popupEl) {
    if (!popupEl) return;
    var app = window.CastleApp;

    var addBtn = popupEl.querySelector(".btn-add-trip");
    if (addBtn) {
      var id = addBtn.getAttribute("data-castle-id");
      updateAddTripButtonText(addBtn, app.trip.indexOf(id) !== -1);
    }

    var visitedBtn = popupEl.querySelector(".btn-visited");
    if (visitedBtn) {
      var vid = visitedBtn.getAttribute("data-castle-id");
      updateVisitedButtonText(visitedBtn, app.visited.has(vid));
    }
  }

  // ---------- trip panel actions ----------

  function optimizeRoute() {
    var app = window.CastleApp;
    if (app.trip.length < 3) return; // nothing meaningful to reorder

    var remaining = app.trip.slice(1);
    var route = [app.trip[0]];
    var currentId = app.trip[0];

    while (remaining.length > 0) {
      var currentCastle = castlesById[currentId];
      var nearestIdx = -1;
      var nearestDist = Infinity;

      remaining.forEach(function (id, idx) {
        var c = castlesById[id];
        if (!currentCastle || !c) return;
        var d = haversineKm(currentCastle.lat, currentCastle.lon, c.lat, c.lon);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = idx;
        }
      });

      if (nearestIdx === -1) {
        // Remaining entries couldn't be measured (shouldn't normally
        // happen) -- append what's left in place and stop.
        route = route.concat(remaining);
        break;
      }

      var nextId = remaining.splice(nearestIdx, 1)[0];
      route.push(nextId);
      currentId = nextId;
    }

    app.trip = route;
    saveTrip();
    renderTripPanel();
    updateRouteLine();
  }

  function clearTrip() {
    var app = window.CastleApp;
    app.trip = [];
    saveTrip();
    renderTripPanel();
    updateRouteLine();
  }

  function shareTrip() {
    var app = window.CastleApp;
    var url = location.origin + location.pathname + "?trip=" + app.trip.join(",");

    function announce() {
      window.CastleApp.showToast("Link copied!");
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(announce)
        .catch(function (err) {
          console.error("Castle Finder: failed to copy trip link", err);
          announce();
        });
    } else {
      announce();
    }
  }

  // ---------- toast helper ----------

  window.CastleApp.showToast = function (message) {
    var toast = document.createElement("div");
    toast.className = "cf-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    // Force layout so the transition below actually animates in.
    void toast.offsetWidth;
    toast.classList.add("cf-toast-visible");

    setTimeout(function () {
      toast.classList.remove("cf-toast-visible");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 2000);
  };

  // ---------- event delegation ----------

  function wireDelegation() {
    document.addEventListener("click", function (e) {
      var target = e.target;
      if (!target || !target.closest) return;

      var addBtn = target.closest(".btn-add-trip");
      if (addBtn) {
        var addId = addBtn.getAttribute("data-castle-id");
        if (addId) {
          toggleTrip(addId);
          updateAddTripButtonText(addBtn, window.CastleApp.trip.indexOf(addId) !== -1);
        }
        return;
      }

      var visitedBtn = target.closest(".btn-visited");
      if (visitedBtn) {
        var visitedId = visitedBtn.getAttribute("data-castle-id");
        if (visitedId) {
          toggleVisited(visitedId);
          updateVisitedButtonText(visitedBtn, window.CastleApp.visited.has(visitedId));
        }
        return;
      }

      var removeBtn = target.closest(".btn-trip-remove");
      if (removeBtn) {
        var removeId = removeBtn.getAttribute("data-castle-id");
        if (removeId) toggleTrip(removeId);
        return;
      }

      if (target.closest("#btn-optimize-route")) {
        optimizeRoute();
        return;
      }
      if (target.closest("#btn-clear-trip")) {
        clearTrip();
        return;
      }
      if (target.closest("#btn-share-trip")) {
        shareTrip();
        return;
      }
    });
  }

  function wirePopupSync() {
    var app = window.CastleApp;
    if (app.map && typeof app.map.on === "function") {
      app.map.on("popupopen", function (e) {
        syncPopupButtons(e.popup && e.popup.getElement ? e.popup.getElement() : null);
      });
    }
  }

  // ---------- hook into castle-data-loaded ----------

  function onCastlesLoaded() {
    if (castlesLoadedHandled) return;
    castlesLoadedHandled = true;

    indexCastles();
    loadInitialState();
    applyVisitedStyles();
    renderTripPanel();
    updateRouteLine();
  }

  // app.js assigns window.CastleApp.applyFilters synchronously (not inside
  // its DOMContentLoaded handler), and this script tag loads after app.js,
  // so the real function is already in place by the time this runs. Wrap
  // it so we find out the instant castle data has finished loading (app.js
  // calls applyFilters() once its fetch resolves), without ever touching
  // app.js itself.
  function hookApplyFilters() {
    var original = window.CastleApp.applyFilters;
    if (typeof original !== "function") return;

    window.CastleApp.applyFilters = function () {
      original();
      if (!castlesLoadedHandled && window.CastleApp.castles && window.CastleApp.castles.length > 0) {
        onCastlesLoaded();
      }
    };
  }

  function init() {
    hookApplyFilters();
    wireDelegation();
    wirePopupSync();

    // Safety net in case castle data was already loaded by the time this
    // ran (e.g. a future load-order change) -- normally the hook above is
    // what triggers onCastlesLoaded().
    if (window.CastleApp.castles && window.CastleApp.castles.length > 0) {
      onCastlesLoaded();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
