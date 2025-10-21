(function () {
  if (window.Chart) return; // already available

  function load(src, ok, fail) {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = ok;
    s.onerror = fail || function(){};
    document.head.appendChild(s);
  }

  const thisScript = document.currentScript;
  let base = '';
  if (thisScript && thisScript.src) {
    const parts = thisScript.src.split('/');
    parts.pop(); 
    base = `${parts.join('/')  }/`;
  } else {
    // Fallback to MagicMirror modules path
    base = '/modules/MMM-EUElectricityPrice/';
  }

  // Try v4 UMD first, then v3
  const v4 = `${base  }node_modules/chart.js/dist/chart.umd.min.js`;
  const v3 = `${base  }node_modules/chart.js/dist/chart.min.js`;

  // Helpful console messages while debugging
  const ok4 = function(){ /* console.log('[MMM-EUElectricityPrice] Chart.js v4 loaded'); */ };
  const ok3 = function(){ /* console.log('[MMM-EUElectricityPrice] Chart.js v3 loaded (fallback)'); */ };
  const fail3 = function(){ console.error('[MMM-EUElectricityPrice] Failed to load Chart.js v3 fallback at:', v3); };
  const fail4 = function(){ /* console.warn('[MMM-EUElectricityPrice] v4 not found at:', v4, '→ trying v3'); */ load(v3, ok3, fail3); };

  load(v4, ok4, fail4);
})();
