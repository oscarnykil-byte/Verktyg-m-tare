// Foton: tas med kameran eller väljs ur bildbiblioteket, skalas ned och sparas på enheten.
import { h, uid, toast } from './util.js';
import { putPhoto, deletePhoto } from './db.js';

const MAX_SIDE = 1600;

async function toDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = h('canvas', {
      width: Math.round(img.naturalWidth * scale),
      height: Math.round(img.naturalHeight * scale),
    });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Fotoruta för ett besök (roomId = null) eller ett rum.
 * @param photos alla foton för besöket (listan uppdateras på plats)
 */
export function photoSection(visitId, roomId, photos) {
  const grid = h('div', { class: 'photo-grid' });
  const mine = () => photos.filter((p) => (p.roomId || null) === (roomId || null));

  const draw = () => grid.replaceChildren(...mine().map((p) =>
    h('div', { class: 'photo' },
      h('img', { src: p.data, alt: 'Foto', loading: 'lazy' }),
      h('button', {
        type: 'button', class: 'photo-del', 'aria-label': 'Ta bort foto',
        onclick: async () => {
          if (!confirm('Ta bort fotot?')) return;
          await deletePhoto(p.id);
          photos.splice(photos.indexOf(p), 1);
          draw();
        },
      }, '✕'))));

  const input = h('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: async () => {
      for (const file of input.files) {
        try {
          const photo = { id: uid(), visitId, roomId: roomId || null, created: Date.now(), data: await toDataUrl(file) };
          await putPhoto(photo);
          photos.push(photo);
        } catch {
          toast('Fotot kunde inte sparas.');
        }
      }
      input.value = '';
      draw();
    },
  });

  draw();
  return h('section', { class: 'card' },
    h('h3', {}, 'Foton'),
    grid,
    input,
    h('button', { type: 'button', class: 'btn small', onclick: () => input.click() }, '+ Lägg till foto'));
}
