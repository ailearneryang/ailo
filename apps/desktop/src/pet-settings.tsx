import { useState } from 'react';
import { petStateLabels, type PetState } from './pet-state';
import { Pet } from './pet';
import { defaultPetPreferences, setPetPreferences, usePetPreferences, type PetPreferences } from './pet-preferences';
import './pet-settings.css';
export function PetSettings() {
  const preferences = usePetPreferences();
  const [previewState, setPreviewState] = useState<PetState>('idle');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  function save(value: PetPreferences) { setError(setPetPreferences(value) ? '' : '设置未能保存，请重试。'); }
  return <div className="settings-page pet-settings">
    <div className="page-heading"><div><h1>宠物与陪伴</h1><p className="muted">让 Ailo 按你喜欢的方式陪伴。设置自动保存，并立即生效。</p></div><button onClick={() => {setNameDraft(null);setPreviewState('idle');save(defaultPetPreferences);}}>恢复默认</button></div>
    <section className="pet-settings-card"><h2>宠物形象</h2><div className="pet-choice"><Pet preview /><div><strong>柴犬 {preferences.name}</strong><p className="muted">你的默认伙伴</p><span className="pet-selected">已选择</span></div></div><label className="pet-name">宠物名字<input aria-label="宠物名字" value={nameDraft ?? preferences.name} maxLength={20} placeholder="Ailo" onChange={event=>{setNameDraft(event.target.value);save({...preferences,name:event.target.value.trim() || 'Ailo'});}} onBlur={()=>setNameDraft(null)}/><small>最多 20 个字，名字会用于首页问候。</small></label></section>
    <section className="pet-settings-card"><h2>显示与互动</h2>
      <label className="pet-option"><span><strong>显示宠物</strong><small>在导航、首页和回复中显示宠物；关闭后使用助手图标。</small></span><input type="checkbox" checked={preferences.visible} onChange={event => save({ ...preferences, visible: event.target.checked })}/></label>
      <label className="pet-option"><span><strong>宠物动画</strong><small>关闭后进入安静模式。系统开启减少动态效果时，也会减少动画。</small></span><input type="checkbox" checked={preferences.animated} onChange={event => save({ ...preferences, animated: event.target.checked })}/></label>
    </section>
    <section className="pet-settings-card"><h2>实时预览</h2><div className="pet-state-options" role="group" aria-label="预览宠物状态">{(['idle','thinking','running','completed','attention'] as PetState[]).map(state=><button key={state} aria-pressed={previewState===state} onClick={()=>setPreviewState(state)}>{({idle:'陪伴',thinking:'思考',running:'执行',completed:'完成',attention:'提醒'})[state]}</button>)}</div><p className="muted pet-preview-description">{petStateLabels[previewState].replace('Ailo',preferences.name)} · 仅预览，不会改变实际任务状态</p><div className="pet-preview"><Pet key={previewState} interactive state={previewState} /><span>{preferences.visible ? preferences.animated ? '点击宠物，和它打个招呼' : '安静陪伴，点击仍可回应' : '已使用助手图标'}</span></div></section>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
