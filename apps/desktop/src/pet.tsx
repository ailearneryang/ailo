import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./pet.css";
import {face,palette} from "../pet-artwork.cjs";
import { petStateLabels, type PetState } from "./pet-state";
import { Icon } from "./icon";
import { interact, usePetInteraction, usePetPreferences } from "./pet-preferences";

/** Full-body animated Shiba, sharing the app icon’s face and palette. */
export function Pet({
  size = "hero",
  thinking = false,
  interactive = false,
  preview = false,
  state,
  motion,
}: {
  size?: "hero" | "brand" | "mini";
  thinking?: boolean;
  interactive?: boolean;
  preview?: boolean;
  state?: PetState;
  motion?: "ambient" | "static";
}) {
  const preferences = usePetPreferences();
  const surface=useRef<HTMLButtonElement & HTMLSpanElement>(null);
  const [inView,setInView]=useState(true),[pageVisible,setPageVisible]=useState(!document.hidden);
  useEffect(()=>{if((motion||(size==="hero"?"ambient":"static"))==="static"&&!interactive)return;const update=()=>setPageVisible(!document.hidden);update();document.addEventListener("visibilitychange",update);const observer=typeof IntersectionObserver!=="undefined"?new IntersectionObserver(entries=>setInView(entries[0]?.isIntersecting??true)):undefined;if(surface.current)observer?.observe(surface.current);return()=>{document.removeEventListener("visibilitychange",update);observer?.disconnect();};},[preferences.visible,preview,motion,size,interactive]);
  const requested = state || (thinking ? "thinking" : "idle");
  const activity = requested==='completed'&&!preferences.celebrations||requested==='attention'&&!preferences.reminders?'idle':requested;
  const sharedInteraction=usePetInteraction();
  const label = petStateLabels[activity].replace("Ailo", preferences.name);
  const [happy, setHappy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function greet() {
    if (timer.current) clearTimeout(timer.current);
    setHappy(true);
    if(!preview)void interact('pat').catch(()=>{});
    timer.current = setTimeout(() => setHappy(false), 1800);
  }
  // Keep shared celebrations on the companion; small identity avatars stay quiet.
  const interactionKind = happy ? 'pat' : !preview && (size === 'hero' || interactive) ? sharedInteraction?.kind : undefined;
  const colors = { '--pet-mint': palette.mint, '--pet-accent': palette.mintAccent, '--pet-detail': palette.mintInk } as CSSProperties;
  const className = `ailo-pet pet-${size} ${activity === "thinking" ? "is-thinking" : ""} is-${activity} ${interactionKind ? `is-happy is-${interactionKind}` : ""} ${preferences.animated&&preferences.style!=="quiet" ? "" : "is-quiet"} ${(motion||(size==="hero"?"ambient":"static"))==="static"?"is-static":""} ${inView&&pageVisible?"":"is-suspended"}`;
  if (!preferences.visible && !preview) return <span ref={surface} style={colors} className={`ailo-pet pet-${size} pet-fallback`} role="img" aria-label={label} title={label}><Icon name="chat" /></span>;
  const compact = size !== "hero";
  const artwork = (
    <>
      <svg className="pet-art" viewBox={compact ? "20 20 116 100" : "0 0 160 150"} fill="none" aria-hidden="true">
        {compact && <rect className="pet-avatar-backdrop" x="20" y="20" width="116" height="100" rx="28" fill={palette.mint} />}
        <ellipse className="pet-shadow" cx="78" cy="138" rx="43" ry="5" fill={palette.mintInk} opacity=".1" />
        <g className="pet-body">
          <g className="pet-tail">
            <path d="M108 120C132 124 146 108 139 95C135 86 123 87 123 96C123 102 132 104 135 97" stroke={palette.furShade} strokeWidth="16" strokeLinecap="round" />
            <path d="M123 96C123 102 132 104 135 97" stroke={palette.cream} strokeWidth="10" strokeLinecap="round" />
          </g>
          <path d="M48 95C51 82 63 78 78 78C95 78 106 87 108 105L112 124C110 134 98 138 78 138C58 138 46 134 44 124Z" fill={palette.fur} />
          <path d="M61 105Q78 99 95 105L99 126Q78 138 57 126Z" fill={palette.cream} />
          <path d="M56 113Q52 121 55 128M100 113Q104 121 101 128" stroke={palette.furShade} strokeWidth="2" strokeLinecap="round" />
          <ellipse cx="55" cy="131" rx="12" ry="7" fill={palette.cream} />
          <ellipse cx="101" cy="131" rx="12" ry="7" fill={palette.cream} />
          <g className="pet-head">
            <path d={face.head} fill={palette.fur} />
            <path d={face.ears} fill={palette.cream} opacity=".65" />
            <path d={face.muzzle} fill={palette.cream} />
            <path d={face.brows} fill={palette.cream} />
            <path d={face.cheeks} fill={palette.blush} opacity=".28" />
            <g className="pet-eyes">
              <path d={face.eyes} fill={palette.ink} />
              <path d={face.highlights} fill={palette.cream} />
            </g>
            <g className="pet-smile-eyes" stroke={palette.ink} strokeWidth="2.7" strokeLinecap="round">
              <path d="M55 73Q60 66 65 73M91 73Q96 66 101 73" />
            </g>
            <path d={face.nose} fill={palette.ink} />
            <path className="pet-mouth" d={face.mouth} stroke={palette.ink} strokeWidth="1.5" strokeLinecap="round" />
          </g>
          <g className="pet-bandana">
            <path d="M59 108Q78 115 97 108L92 119Q85 123 78 128L64 120Z" fill={palette.sage} />
            <path d="M64 112Q78 117 92 112" stroke={palette.ink} strokeOpacity=".12" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="78" cy="119" r="2" fill={palette.ink} opacity=".65" />
          </g>
          {preferences.accessory==='scarf'&&<path d="M58 109Q78 119 98 109L92 124L79 131L73 122L64 132L59 121Z" fill={palette.furShade}/>}
          {preferences.accessory==='star'&&<path d="m78 112 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill="#DDAE47"/>}
          {preferences.accessory==='crown'&&<path d="m62 37-5-17 13 8 8-15 9 15 13-8-5 17Z" fill="#DDAE47" stroke="#B48B31" strokeWidth="2"/>}
        </g>
        {interactionKind==='feed'&&<g className="pet-bowl"><ellipse cx="79" cy="137" rx="20" ry="5" fill={palette.furShade}/><path d="M59 136h40l-7 12H66Z" fill={palette.mintInk}/></g>}
        {interactionKind==='play'&&<circle className="pet-ball" cx="130" cy="130" r="10" fill={palette.mintAccent} stroke={palette.cream} strokeWidth="3"/>}
        <g className="pet-thoughts" fill={palette.mintInk}>
          <circle cx="127" cy="49" r="2.5" /><circle cx="136" cy="39" r="3" /><circle cx="145" cy="28" r="4" />
        </g>
        <g className="pet-state-badge" transform={compact ? "translate(-15 5)" : undefined}><circle cx="134" cy="33" r="15" fill={activity === "attention" ? palette.attention : palette.mintAccent} stroke={palette.cream} strokeWidth="2"/>{activity === "completed" ? <path d="m127 33 5 5 9-10" stroke={palette.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/> : <path d="M134 25v10m0 6h.01" stroke={palette.attentionInk} strokeWidth="3" strokeLinecap="round"/>}</g>
        <path className="pet-heart" d="M128 27C119 20 112 30 117 35L128 44L139 35C144 30 137 20 128 27Z" fill={palette.furShade} />
      </svg>
      {interactive && (
        <span className="sr-only" role="status">
          {happy ? "汪！我在呢。" : ""}
        </span>
      )}
    </>
  );
  return interactive ? (
    <button
      ref={surface}
      type="button"
      style={colors}
      className={className}
      aria-label={`摸摸 ${preferences.name} 柴犬`}
      title={activity === "idle" ? "摸摸我" : label}
      onClick={greet}
    >
      {artwork}
    </button>
  ) : (
    <span
      ref={surface}
      style={colors}
      className={className}
      role="img"
      aria-label={activity === "idle" ? `${preferences.name} 柴犬` : label}
      title={label}
    >
      {artwork}
    </span>
  );
}

/** Product identity stays static, independently of companion visibility. */
export function BrandMark({size=56}:{size?:number}){return <img className="ailo-brand-mark" src="./ailo.png" width={size} height={size} alt="Ailo" draggable={false}/>;}
