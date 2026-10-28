// Loading must accept attachment-only conversations accepted by storage.
export function validateLoadedWorkspace(state) {
  if (!state || !Array.isArray(state.tasks) || state.tasks.some(task =>
    !task || typeof task.id !== 'string' || !task.id ||
    typeof task.request !== 'string' || !Array.isArray(task.materials) ||
    (!task.request.trim() && !task.materials.length)
  )) throw Error('保存的数据格式不正确');
}
