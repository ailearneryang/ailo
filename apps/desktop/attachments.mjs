export function isImageMaterial(material) {
  return !!material.sourceId && /\.(png|jpe?g|webp|gif)$/i.test(material.name);
}
export function canSendMaterial(material) {
  return typeof material.text === 'string' || isImageMaterial(material);
}
