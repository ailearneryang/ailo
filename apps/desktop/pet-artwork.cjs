// Shared vector artwork for the app icon, navigation avatars and companion.
const palette = {
  fur: '#EFB366', furShade: '#D79850', cream: '#FFF5E6',
  ink: '#304F46', sage: '#AED7C3', blush: '#DC977B',
  mint: '#DCF0E5', mintAccent: '#AED7C3', mintInk: '#5F8B75',
  mintBorder: '#DDE7DE', attention: '#F3DDB6', attentionInk: '#8A622C',
};
const face = {
  head: 'M36 54C33 45 33 29 39 27C44 25 55 32 63 40C73 37 85 37 95 40C103 32 114 25 119 28C124 32 123 46 120 55C125 63 128 72 127 81C126 99 106 111 78 111C50 111 30 100 29 82C28 72 31 62 36 54Z',
  ears: 'M40 36Q40 33 43 35L53 44Q46 45 40 49ZM113 35Q116 33 116 37L116 49Q110 45 104 44Z',
  muzzle: 'M30 83C33 76 42 76 52 82C64 89 68 81 78 81C88 81 92 89 104 82C114 76 123 76 126 83C123 100 103 111 78 111C53 111 33 100 30 83Z',
  brows: 'M55 60C56 57 60 56 63 58C61 60 58 61 55 60ZM93 58C96 56 100 57 101 60C98 61 95 60 93 58Z',
  eyes: 'M63.8 72a3.8 4.8 0 1 1-7.6 0a3.8 4.8 0 1 1 7.6 0ZM99.8 72a3.8 4.8 0 1 1-7.6 0a3.8 4.8 0 1 1 7.6 0Z',
  highlights: 'M60.1 70.5a1 1 0 1 1-2 0a1 1 0 1 1 2 0ZM96.1 70.5a1 1 0 1 1-2 0a1 1 0 1 1 2 0Z',
  cheeks: 'M50 82a5 2.5 0 1 1-10 0a5 2.5 0 1 1 10 0ZM116 82a5 2.5 0 1 1-10 0a5 2.5 0 1 1 10 0Z',
  nose: 'M72 87C72 84 84 84 84 87C84 90 80 93 78 93C76 93 72 90 72 87Z',
  mouth: 'M78 93V96M71.5 96Q74.5 100 78 96Q81.5 100 84.5 96',
};
function faceSvg() {
  return `<path d="${face.head}" fill="${palette.fur}"/><path d="${face.ears}" fill="${palette.cream}" opacity=".65"/><path d="${face.muzzle}" fill="${palette.cream}"/><path d="${face.brows}" fill="${palette.cream}"/><path d="${face.cheeks}" fill="${palette.blush}" opacity=".28"/><path d="${face.eyes}" fill="${palette.ink}"/><path d="${face.highlights}" fill="${palette.cream}"/><path d="${face.nose}" fill="${palette.ink}"/><path d="${face.mouth}" stroke="${palette.ink}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`;
}
function iconSvg(size = 1024) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><rect x="80" y="86" width="864" height="864" rx="194" fill="#617B6C" opacity=".08"/><rect x="80" y="80" width="864" height="864" rx="194" fill="${palette.mint}" stroke="${palette.mintBorder}" stroke-width="2"/><g transform="translate(-34 23) scale(7)">${faceSvg()}</g></svg>`;
}
module.exports = { palette, face, faceSvg, iconSvg };
