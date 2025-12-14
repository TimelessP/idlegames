// Download helpers
// SVG direct save/copy removed — PNG is used for bitmap export and clipboard

function savePNGToFile() {
  const area = document.getElementById('portrait-area');
  const svgEl = area.querySelector('svg');
  if (!svgEl) return;
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgEl);
  // Remove the halftone rect from the exported SVG so we draw a single halftone overlay on the canvas
  const exportSvgString = svgString.replace(/<rect[^>]*fill=["']url\(#halftone\)["'][^>]*\/?>(\s*)/i, '');
  const svg64 = btoa(unescape(encodeURIComponent(exportSvgString)));
  const imgSrc = 'data:image/svg+xml;base64,' + svg64;
  const img = new window.Image();
  img.onload = function() {
    // target dimensions from inputs
    const targetW = parseInt(document.getElementById('export-width')?.value) || img.width;
    const targetH = parseInt(document.getElementById('export-height')?.value) || img.height;
    const svgW = parseFloat(svgEl.getAttribute('width')) || img.width;
    const svgH = parseFloat(svgEl.getAttribute('height')) || img.height;

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    // Fill background if present in svg style
    let bg = null;
    const styleAttr = svgEl.getAttribute('style') || '';
    const m = styleAttr.match(/background\s*:\s*([^;\"]+)/i);
    if (m) bg = m[1].trim();
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else ctx.clearRect(0, 0, canvas.width, canvas.height);

    // scale to fit (contain) and center
    const scale = Math.min(targetW / svgW, targetH / svgH);
    const drawW = svgW * scale;
    const drawH = svgH * scale;
    const dx = Math.round((targetW - drawW) / 2);
    const dy = Math.round((targetH - drawH) / 2);
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, drawW, drawH);

    // Parse halftone pattern values from the original SVG string so we can replicate it
    let patternCell = 4; // svg units
    let dotR = 0.8; // svg units
    let dotFill = '#000';
    let dotOpacity = 0.1;
    try {
      const patMatch = svgString.match(/<pattern[^>]*id="halftone"[^>]*width="([0-9.\.]+)"/i);
      if (patMatch) patternCell = parseFloat(patMatch[1]) || patternCell;
      const circMatch = svgString.match(/<pattern[\s\S]*?id="halftone"[\s\S]*?<circle[^>]*r="([0-9.\.]+)"[^>]*fill="([^"]+)"[^>]*opacity="([0-9\.]+)"/i);
      if (circMatch) {
        dotR = parseFloat(circMatch[1]) || dotR;
        dotFill = circMatch[2] || dotFill;
        dotOpacity = parseFloat(circMatch[3]) || dotOpacity;
      }
    } catch (e) {}

    // Draw halftone across the entire canvas as a single overlay
    const spacing = patternCell * scale;
    const radius = Math.max(0.5, dotR * scale);
    if (spacing > 0) {
      ctx.fillStyle = dotFill;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = dotOpacity;
      for (let y = 0; y < targetH + spacing; y += spacing) {
        for (let x = 0; x < targetW + spacing; x += spacing) {
          ctx.beginPath();
          ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = prevAlpha;
    }

    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'portrait.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    }, 'image/png');
  };
  img.onerror = function() { alert('PNG render failed.'); };
  img.src = imgSrc;
}
// Noir portrait generator (vanilla JS, SVG string)
function generatePortrait(data, size = 'md') {
  const noir = {
    black: 'hsl(30,10%,5%)',
    charcoal: 'hsl(30,8%,12%)',
    paper: 'hsl(40,25%,88%)',
    paperDark: 'hsl(35,20%,75%)',
    ink: 'hsl(30,10%,10%)',
    blood: 'hsl(0,70%,40%)',
    amber: 'hsl(35,80%,55%)',
    sepia: 'hsl(30,40%,45%)'
  };
  const dimensions = {
    sm: { width: 60, height: 80, scale: 0.6 },
    md: { width: 100, height: 130, scale: 1 },
    lg: { width: 160, height: 200, scale: 1.6 }
  };
  const { width, height, scale } = dimensions[size] || dimensions.md;

  // All stroke widths and radii are now scaled
  const sw1 = 2 * scale; // base stroke
  const sw2 = 1.5 * scale;
  const sw3 = 2.5 * scale;
  const sw4 = 3 * scale;
  const sw5 = 4 * scale;

  const faceShapes = {
    round: `M ${width * 0.2} ${height * 0.35} Q ${width * 0.2} ${height * 0.15} ${width * 0.5} ${height * 0.15} Q ${width * 0.8} ${height * 0.15} ${width * 0.8} ${height * 0.35} Q ${width * 0.85} ${height * 0.6} ${width * 0.5} ${height * 0.75} Q ${width * 0.15} ${height * 0.6} ${width * 0.2} ${height * 0.35}`,
    oval: `M ${width * 0.25} ${height * 0.3} Q ${width * 0.25} ${height * 0.12} ${width * 0.5} ${height * 0.12} Q ${width * 0.75} ${height * 0.12} ${width * 0.75} ${height * 0.3} Q ${width * 0.78} ${height * 0.55} ${width * 0.5} ${height * 0.78} Q ${width * 0.22} ${height * 0.55} ${width * 0.25} ${height * 0.3}`,
    square: `M ${width * 0.22} ${height * 0.15} L ${width * 0.78} ${height * 0.15} L ${width * 0.8} ${height * 0.6} Q ${width * 0.7} ${height * 0.75} ${width * 0.5} ${height * 0.75} Q ${width * 0.3} ${height * 0.75} ${width * 0.2} ${height * 0.6} Z`,
    angular: `M ${width * 0.5} ${height * 0.12} L ${width * 0.78} ${height * 0.25} L ${width * 0.75} ${height * 0.55} L ${width * 0.5} ${height * 0.78} L ${width * 0.25} ${height * 0.55} L ${width * 0.22} ${height * 0.25} Z`
  };
  const eyeY = height * 0.38;
  const leftX = width * 0.35;
  const rightX = width * 0.65;
  function eyes() {
    switch (data.eyeStyle) {
      case 'narrow':
        return `<ellipse cx="${leftX}" cy="${eyeY}" rx="${width * 0.08}" ry="${height * 0.025}" fill="${noir.black}" />` +
               `<ellipse cx="${rightX}" cy="${eyeY}" rx="${width * 0.08}" ry="${height * 0.025}" fill="${noir.black}" />`;
      case 'round':
        return `<circle cx="${leftX}" cy="${eyeY}" r="${width * 0.06}" fill="${noir.paper}" stroke="${noir.black}" stroke-width="${sw1}" />` +
               `<circle cx="${leftX}" cy="${eyeY}" r="${width * 0.025}" fill="${noir.black}" />` +
               `<circle cx="${rightX}" cy="${eyeY}" r="${width * 0.06}" fill="${noir.paper}" stroke="${noir.black}" stroke-width="${sw1}" />` +
               `<circle cx="${rightX}" cy="${eyeY}" r="${width * 0.025}" fill="${noir.black}" />`;
      case 'hooded':
        return `<path d="M ${leftX - width * 0.08} ${eyeY} Q ${leftX} ${eyeY + height * 0.02} ${leftX + width * 0.08} ${eyeY}" stroke="${noir.black}" stroke-width="${sw4}" fill="none" />` +
               `<path d="M ${rightX - width * 0.08} ${eyeY} Q ${rightX} ${eyeY + height * 0.02} ${rightX + width * 0.08} ${eyeY}" stroke="${noir.black}" stroke-width="${sw4}" fill="none" />` +
               `<line x1="${leftX - width * 0.1}" y1="${eyeY - height * 0.02}" x2="${leftX + width * 0.1}" y2="${eyeY - height * 0.015}" stroke="${noir.black}" stroke-width="${sw1}" />` +
               `<line x1="${rightX - width * 0.1}" y1="${eyeY - height * 0.015}" x2="${rightX + width * 0.1}" y2="${eyeY - height * 0.02}" stroke="${noir.black}" stroke-width="${sw1}" />`;
      case 'wide':
        return `<ellipse cx="${leftX}" cy="${eyeY}" rx="${width * 0.09}" ry="${height * 0.05}" fill="${noir.paper}" stroke="${noir.black}" stroke-width="${sw1}" />` +
               `<circle cx="${leftX}" cy="${eyeY}" r="${width * 0.035}" fill="${noir.black}" />` +
               `<ellipse cx="${rightX}" cy="${eyeY}" rx="${width * 0.09}" ry="${height * 0.05}" fill="${noir.paper}" stroke="${noir.black}" stroke-width="${sw1}" />` +
               `<circle cx="${rightX}" cy="${eyeY}" r="${width * 0.035}" fill="${noir.black}" />`;
      default:
        return '';
    }
  }
  const noseY = height * 0.48;
  function nose() {
    const centerX = width * 0.5;
    switch (data.noseStyle) {
      case 'long':
        return `<path d="M ${centerX} ${eyeY + height * 0.05} L ${centerX - width * 0.03} ${noseY + height * 0.08} L ${centerX + width * 0.03} ${noseY + height * 0.08}" stroke="${noir.black}" stroke-width="${sw1}" fill="none" />`;
      case 'short':
        return `<path d="M ${centerX} ${noseY} L ${centerX - width * 0.04} ${noseY + height * 0.03} L ${centerX + width * 0.04} ${noseY + height * 0.03}" stroke="${noir.black}" stroke-width="${sw1}" fill="none" />`;
      case 'broad':
        return `<path d="M ${centerX} ${eyeY + height * 0.05} Q ${centerX - width * 0.08} ${noseY + height * 0.05} ${centerX - width * 0.06} ${noseY + height * 0.06} L ${centerX + width * 0.06} ${noseY + height * 0.06} Q ${centerX + width * 0.08} ${noseY + height * 0.05} ${centerX} ${eyeY + height * 0.05}" stroke="${noir.black}" stroke-width="${sw1}" fill="none" />`;
      case 'pointed':
        return `<path d="M ${centerX} ${eyeY + height * 0.03} L ${centerX} ${noseY + height * 0.08} M ${centerX - width * 0.03} ${noseY + height * 0.06} L ${centerX + width * 0.03} ${noseY + height * 0.06}" stroke="${noir.black}" stroke-width="${sw1}" fill="none" />`;
      default:
        return '';
    }
  }
  const mouthY = height * 0.62;
  function mouth() {
    const centerX = width * 0.5;
    switch (data.mouthStyle) {
      case 'thin':
        return `<line x1="${centerX - width * 0.1}" y1="${mouthY}" x2="${centerX + width * 0.1}" y2="${mouthY}" stroke="${noir.black}" stroke-width="${sw1}" />`;
      case 'full':
        return `<path d="M ${centerX - width * 0.12} ${mouthY} Q ${centerX} ${mouthY + height * 0.03} ${centerX + width * 0.12} ${mouthY}" stroke="${noir.black}" stroke-width="${sw1}" fill="none" />` +
               `<path d="M ${centerX - width * 0.1} ${mouthY} Q ${centerX} ${mouthY - height * 0.015} ${centerX + width * 0.1} ${mouthY}" stroke="${noir.black}" stroke-width="${sw2}" fill="none" />`;
      case 'smirk':
        return `<path d="M ${centerX - width * 0.1} ${mouthY + height * 0.01} Q ${centerX} ${mouthY} ${centerX + width * 0.12} ${mouthY - height * 0.02}" stroke="${noir.black}" stroke-width="${sw1}" fill="none" />`;
      case 'stern':
        return `<path d="M ${centerX - width * 0.12} ${mouthY - height * 0.01} L ${centerX} ${mouthY} L ${centerX + width * 0.12} ${mouthY - height * 0.01}" stroke="${noir.black}" stroke-width="${sw3}" fill="none" />`;
      default:
        return '';
    }
  }
  function hair() {
    switch (data.hairStyle) {
      case 'bald':
        return '';
      case 'slick':
        return `<path d="M ${width * 0.18} ${height * 0.22} Q ${width * 0.2} ${height * 0.08} ${width * 0.5} ${height * 0.06} Q ${width * 0.8} ${height * 0.08} ${width * 0.82} ${height * 0.22} Q ${width * 0.85} ${height * 0.15} ${width * 0.5} ${height * 0.05} Q ${width * 0.15} ${height * 0.15} ${width * 0.18} ${height * 0.22}" fill="${noir.black}" />`;
      case 'messy':
        return `<path d="M ${width * 0.15} ${height * 0.25} Q ${width * 0.1} ${height * 0.1} ${width * 0.3} ${height * 0.05}" stroke="${noir.black}" stroke-width="${sw5}" fill="none" />` +
               `<path d="M ${width * 0.3} ${height * 0.15} Q ${width * 0.35} ${height * 0.02} ${width * 0.5} ${height * 0.03}" stroke="${noir.black}" stroke-width="${sw5}" fill="none" />` +
               `<path d="M ${width * 0.5} ${height * 0.08} Q ${width * 0.65} ${height * 0.01} ${width * 0.75} ${height * 0.12}" stroke="${noir.black}" stroke-width="${sw5}" fill="none" />` +
               `<path d="M ${width * 0.7} ${height * 0.18} Q ${width * 0.9} ${height * 0.08} ${width * 0.85} ${height * 0.25}" stroke="${noir.black}" stroke-width="${sw5}" fill="none" />`;
      case 'hat':
        return `<ellipse cx="${width * 0.5}" cy="${height * 0.12}" rx="${width * 0.4}" ry="${height * 0.04}" fill="${noir.black}" />` +
               `<path d="M ${width * 0.25} ${height * 0.12} Q ${width * 0.25} ${height * 0.02} ${width * 0.5} ${height * 0.02} Q ${width * 0.75} ${height * 0.02} ${width * 0.75} ${height * 0.12}" fill="${noir.charcoal}" stroke="${noir.black}" stroke-width="${sw1}" />`;
      case 'long':
        return `<path d="M ${width * 0.12} ${height * 0.2} Q ${width * 0.1} ${height * 0.1} ${width * 0.5} ${height * 0.05} Q ${width * 0.9} ${height * 0.1} ${width * 0.88} ${height * 0.2} L ${width * 0.9} ${height * 0.5} Q ${width * 0.85} ${height * 0.6} ${width * 0.8} ${height * 0.55} L ${width * 0.75} ${height * 0.25} L ${width * 0.25} ${height * 0.25} L ${width * 0.2} ${height * 0.55} Q ${width * 0.15} ${height * 0.6} ${width * 0.1} ${height * 0.5} Z" fill="${noir.black}" />`;
      default:
        return '';
    }
  }
  function accessory() {
    switch (data.accessory) {
      case 'none':
        return '';
      case 'glasses':
        return `<circle cx="${leftX}" cy="${eyeY}" r="${width * 0.11}" fill="none" stroke="${noir.black}" stroke-width="${sw1}" />` +
               `<circle cx="${rightX}" cy="${eyeY}" r="${width * 0.11}" fill="none" stroke="${noir.black}" stroke-width="${sw1}" />` +
               `<line x1="${width * 0.46}" y1="${eyeY}" x2="${width * 0.54}" y2="${eyeY}" stroke="${noir.black}" stroke-width="${sw1}" />`;
      case 'scar':
        return `<path d="M ${width * 0.6} ${height * 0.28} L ${width * 0.7} ${height * 0.45} L ${width * 0.65} ${height * 0.55}" stroke="${noir.blood}" stroke-width="${sw1}" fill="none" opacity="0.8" />`;
      case 'mustache':
        return `<path d="M ${width * 0.35} ${height * 0.55} Q ${width * 0.5} ${height * 0.58} ${width * 0.65} ${height * 0.55} Q ${width * 0.6} ${height * 0.52} ${width * 0.5} ${height * 0.53} Q ${width * 0.4} ${height * 0.52} ${width * 0.35} ${height * 0.55}" fill="${noir.black}" />`;
      case 'cigarette':
        return `<rect x="${width * 0.55}" y="${mouthY - height * 0.01}" width="${width * 0.25}" height="${height * 0.025}" fill="${noir.paper}" stroke="${noir.black}" stroke-width="${scale}" transform="rotate(15 ${width * 0.55} ${mouthY})" />` +
               `<circle cx="${width * 0.78}" cy="${mouthY + height * 0.02}" r="${width * 0.015}" fill="${noir.amber}" opacity="0.8" />`;
      default:
        return '';
    }
  }
  // Shadow/noir effect
  const shadowGradientId = `shadow-${Math.random().toString(36).substr(2, 9)}`;
  // SVG string
  const svg = `\n<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:${noir.paper};">
    <defs>
      <linearGradient id="${shadowGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="transparent" />
        <stop offset="${(1 - (data.shadowIntensity || 0.5)) * 100}%" stop-color="transparent" />
        <stop offset="100%" stop-color="${noir.black}" stop-opacity="${data.shadowIntensity || 0.5}" />
      </linearGradient>
      <pattern id="halftone" width="${4 * scale}" height="${4 * scale}" patternUnits="userSpaceOnUse">
        <circle cx="${2 * scale}" cy="${2 * scale}" r="${0.8 * scale}" fill="${noir.black}" opacity="0.1" />
      </pattern>
    </defs>
    <rect x="${width * 0.38}" y="${height * 0.7}" width="${width * 0.24}" height="${height * 0.2}" fill="${noir.paperDark}" />
    <path d="M ${width * 0.1} ${height * 0.95} L ${width * 0.35} ${height * 0.75} L ${width * 0.5} ${height * 0.82} L ${width * 0.65} ${height * 0.75} L ${width * 0.9} ${height * 0.95} L ${width * 0.1} ${height * 0.95}" fill="${noir.charcoal}" stroke="${noir.black}" stroke-width="2" />
    <path d="${faceShapes[data.faceShape] || faceShapes.round}" fill="${noir.paperDark}" stroke="${noir.black}" stroke-width="2" />
    ${eyes()}
    ${nose()}
    ${mouth()}
    ${hair()}
    ${accessory()}
    <path d="${faceShapes[data.faceShape] || faceShapes.round}" fill="url(#${shadowGradientId})" />
    <rect width="${width}" height="${height}" fill="url(#halftone)" />
  </svg>\n`;
  // Labels
  const labels = {
    'Face Shape': data.faceShape,
    'Eyes': data.eyeStyle,
    'Nose': data.noseStyle,
    'Mouth': data.mouthStyle,
    'Hair': data.hairStyle,
    'Accessory': data.accessory,
    'Shadow': (data.shadowIntensity || 0.5).toFixed(2)
  };
  return { svg, labels };
}

// Demo: random portrait generator
function randomPortraitData() {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  return {
    faceShape: pick(['round','oval','square','angular']),
    eyeStyle: pick(['narrow','round','hooded','wide']),
    noseStyle: pick(['long','short','broad','pointed']),
    mouthStyle: pick(['thin','full','smirk','stern']),
    hairStyle: pick(['bald','slick','messy','hat','long']),
    accessory: pick(['none','glasses','scar','mustache','cigarette']),
    shadowIntensity: 0.4 + Math.random() * 0.5
  };
}


function renderRandomPortrait() {
  const data = randomPortraitData();
  const { svg, labels } = generatePortrait(data, 'lg');
  document.getElementById('portrait-area').innerHTML = svg;
  // Show labels
  let html = '<div style="margin-top:1rem;text-align:left;display:inline-block;font-family:monospace;font-size:1.1em;background:#232323;padding:0.7em 1.2em;border-radius:8px;box-shadow:0 2px 8px #0005;">';
  for (const [k, v] of Object.entries(labels)) {
    html += `<div><b>${k}:</b> ${v}</div>`;
  }
  html += '</div>';
  document.getElementById('portrait-area').insertAdjacentHTML('beforeend', html);
  // Reflect generated values back into selectors (if present)
  try {
    const setIf = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setIf('sel-face', data.faceShape);
    setIf('sel-eyes', data.eyeStyle);
    setIf('sel-nose', data.noseStyle);
    setIf('sel-mouth', data.mouthStyle);
    setIf('sel-hair', data.hairStyle);
    setIf('sel-accessory', data.accessory);
    const sh = document.getElementById('sel-shadow'); if (sh) sh.value = (data.shadowIntensity || 0.5).toFixed(2);
  } catch(e){}
}

// Clipboard helpers
// SVG clipboard copy removed

async function copyPNGToClipboard() {
  const area = document.getElementById('portrait-area');
  const svgEl = area.querySelector('svg');
  if (!svgEl) return;
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgEl);
    // Remove the halftone rect from the exported SVG so we draw a single halftone overlay on the canvas
    const exportSvgString = svgString.replace(/<rect[^>]*fill=["']url\(#halftone\)["'][^>]*\/?>(\s*)/i, '');
    const svg64 = btoa(unescape(encodeURIComponent(exportSvgString)));
  const imgSrc = 'data:image/svg+xml;base64,' + svg64;
  const img = new window.Image();
  img.onload = async function() {
    try {
      const targetW = parseInt(document.getElementById('export-width')?.value) || img.width;
      const targetH = parseInt(document.getElementById('export-height')?.value) || img.height;
      const svgW = parseFloat(svgEl.getAttribute('width')) || img.width;
      const svgH = parseFloat(svgEl.getAttribute('height')) || img.height;

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');

      // preserve background if defined in svg style
      let bg = null;
      const styleAttr = svgEl.getAttribute('style') || '';
      const m = styleAttr.match(/background\s*:\s*([^;\"]+)/i);
      if (m) bg = m[1].trim();
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else ctx.clearRect(0, 0, canvas.width, canvas.height);

      const scale = Math.min(targetW / svgW, targetH / svgH);
      const drawW = svgW * scale;
      const drawH = svgH * scale;
      const dx = Math.round((targetW - drawW) / 2);
      const dy = Math.round((targetH - drawH) / 2);
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, drawW, drawH);

      // Parse halftone pattern values from the SVG string so we can replicate it
      let patternCell = 4; // svg units
      let dotR = 0.8; // svg units
      let dotFill = '#000';
      let dotOpacity = 0.1;
      try {
        const patMatch = svgString.match(/<pattern[^>]*id="halftone"[^>]*width="([0-9.\.]+)"/i);
        if (patMatch) patternCell = parseFloat(patMatch[1]) || patternCell;
        const circMatch = svgString.match(/<pattern[\s\S]*?id="halftone"[\s\S]*?<circle[^>]*r="([0-9.\.]+)"[^>]*fill="([^"]+)"[^>]*opacity="([0-9\.]+)"/i);
        if (circMatch) {
          dotR = parseFloat(circMatch[1]) || dotR;
          dotFill = circMatch[2] || dotFill;
          dotOpacity = parseFloat(circMatch[3]) || dotOpacity;
        }
      } catch (e) {}

      // Draw halftone across the entire canvas as a single overlay
      const spacing = patternCell * scale;
      const radius = Math.max(0.5, dotR * scale);
      if (spacing > 0) {
        ctx.fillStyle = dotFill;
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = dotOpacity;
        for (let y = 0; y < targetH + spacing; y += spacing) {
          for (let x = 0; x < targetW + spacing; x += spacing) {
            ctx.beginPath();
            ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = prevAlpha;
      }

      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('PNG creation failed');
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      showCopyStatus('PNG copied!');
    } catch (e) {
      alert('Copy failed: ' + (e && e.message));
    }
  };
  img.onerror = function() { alert('PNG render failed.'); };
  img.src = imgSrc;
}

function showCopyStatus(msg) {
  let el = document.getElementById('copy-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'copy-status';
    el.style.cssText = 'position:fixed;top:1.5rem;right:1.5rem;background:#232323;color:#fff;padding:0.7em 1.2em;border-radius:8px;box-shadow:0 2px 8px #0005;z-index:9999;font-size:1.1em;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 1200);
}

window.addEventListener('DOMContentLoaded', () => {
  renderRandomPortrait();
  document.getElementById('randomize').addEventListener('click', renderRandomPortrait);
  document.getElementById('copy-png').addEventListener('click', copyPNGToClipboard);
  document.getElementById('save-png').addEventListener('click', savePNGToFile);
  // Generate from selectors
  const generateBtn = document.getElementById('generate');
  if (generateBtn) generateBtn.addEventListener('click', () => {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const sel = v => { const e = document.getElementById(v); return e ? e.value : ''; };
    const data = {
      faceShape: sel('sel-face') || pick(['round','oval','square','angular']),
      eyeStyle: sel('sel-eyes') || pick(['narrow','round','hooded','wide']),
      noseStyle: sel('sel-nose') || pick(['long','short','broad','pointed']),
      mouthStyle: sel('sel-mouth') || pick(['thin','full','smirk','stern']),
      hairStyle: sel('sel-hair') || pick(['bald','slick','messy','hat','long']),
      accessory: sel('sel-accessory') || pick(['none','glasses','scar','mustache','cigarette']),
      shadowIntensity: parseFloat(sel('sel-shadow')) || (0.4 + Math.random() * 0.5)
    };
    const { svg, labels } = generatePortrait(data, 'lg');
    document.getElementById('portrait-area').innerHTML = svg;
    let html = '<div style="margin-top:1rem;text-align:left;display:inline-block;font-family:monospace;font-size:1.1em;background:#232323;padding:0.7em 1.2em;border-radius:8px;box-shadow:0 2px 8px #0005;">';
    for (const [k, v] of Object.entries(labels)) html += `<div><b>${k}:</b> ${v}</div>`;
    html += '</div>';
    document.getElementById('portrait-area').insertAdjacentHTML('beforeend', html);
  });
});
