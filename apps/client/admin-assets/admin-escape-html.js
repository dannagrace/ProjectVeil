(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"\'/`]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
      "/": "&#47;",
      "`": "&#96;"
    })[character] || character);
  }

  window.VeilAdmin = Object.freeze({ escapeHtml });
})();
