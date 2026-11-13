// Compressão de imagem no navegador: redimensiona para no máximo 1024 px e gera JPEG ~0,8.
// A foto não sai do aparelho além da busca (o servidor não guarda).

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não consegui abrir essa imagem. Tente outra foto ou print.'));
    };
    img.src = url;
  });
}

function drawTo(img, max, quality) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG com transparência vira fundo branco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * @param {File} file
 * @returns {Promise<{ mimeType: string, data: string, thumb: string, bytes: number }>}
 *   data = base64 sem o prefixo "data:"; thumb = dataURL pequena para mostrar na tela.
 */
export async function compressImage(file, { max = 1024, quality = 0.8 } = {}) {
  if (!file || !/^image\//.test(file.type || 'image/')) {
    throw new Error('Escolha um arquivo de imagem (foto ou print).');
  }
  const { img, url } = await loadImage(file);
  try {
    let q = quality;
    let dataUrl = drawTo(img, max, q);
    // Garante folga abaixo do limite de 3 MB da API
    while (dataUrl.length > 2_800_000 && q > 0.45) {
      q -= 0.15;
      dataUrl = drawTo(img, max, q);
    }
    const thumb = drawTo(img, 200, 0.7);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return { mimeType: 'image/jpeg', data, thumb, bytes: Math.round((data.length * 3) / 4) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
