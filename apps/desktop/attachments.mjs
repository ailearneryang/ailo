export function isImageMaterial(material) {
  return !!material.sourceId && /\.(png|jpe?g|webp|gif)$/i.test(material.name);
}
export function canSendMaterial(material) {
  return typeof material.text === 'string' || (typeof material.sourceId === 'string' && /^[a-f0-9-]{36}$/.test(material.sourceId));
}
export function hasMessageContent(content, materials = []) {
  return (typeof content === 'string' && !!content.trim()) ||
    (Array.isArray(materials) && materials.length > 0 && materials.every(m => m && canSendMaterial(m)));
}
