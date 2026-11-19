(function () {
  window.__log = [];
  var rh = window.restoreHistory;
  var pt = window.paintThread;
  window.restoreHistory = function () {
    var st = (new Error().stack || '').split('\n').slice(2, 4).join(' <= ');
    window.__log.push('RH<=' + st.slice(0, 200));
    return rh.apply(this, arguments);
  };
  window.paintThread = function (d) {
    window.__log.push('PT[' + String(d.id || '?').slice(0, 24) + ']:' + (d.messages || []).length);
    return pt.apply(this, arguments);
  };
})()
