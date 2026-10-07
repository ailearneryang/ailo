import { useEffect, useRef, useState } from "react";
import "./pet.css";
import { petStateLabels, type PetState } from "./pet-state";
import { Icon } from "./icon";
import { usePetPreferences } from "./pet-preferences";

/** Full-body animated Shiba, sharing the app icon’s face and palette. */
export function Pet({
  size = "hero",
  thinking = false,
  interactive = false,
  preview = false,
  state,
}: {
  size?: "hero" | "brand" | "mini";
  thinking?: boolean;
  interactive?: boolean;
  preview?: boolean;
  state?: PetState;
}) {
  const preferences = usePetPreferences();
  const activity = state || (thinking ? "thinking" : "idle");
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
    timer.current = setTimeout(() => setHappy(false), 1800);
  }
  const className = `ailo-pet pet-${size} ${activity === "thinking" ? "is-thinking" : ""} is-${activity} ${happy ? "is-happy" : ""} ${preferences.animated ? "" : "is-quiet"}`;
  if (!preferences.visible && !preview) return <span className={`ailo-pet pet-${size} pet-fallback`} role="img" aria-label={label} title={label}><Icon name="chat" /></span>;
  const artwork = (
    <>
      <svg className="pet-art" viewBox="0 0 160 150" fill="none" aria-hidden="true">
        <ellipse cx="78" cy="138" rx="43" ry="5" fill="#285447" opacity=".09" />
        <g className="pet-body">
          <g className="pet-tail">
            <path d="M109 119C137 124 151 104 141 89C133 77 116 84 121 96C124 102 133 101 135 95" stroke="#D99750" strokeWidth="17" strokeLinecap="round" />
            <path d="M121 96C124 102 133 101 135 95" stroke="#FFF4DF" strokeWidth="10" strokeLinecap="round" />
          </g>
          <path d="M45 94C47 78 60 74 78 74C100 74 110 87 111 106L115 125C102 139 50 139 40 125Z" fill="#ECAF68" />
          <path d="M59 100Q78 92 97 100L101 126Q79 139 54 126Z" fill="#FFF4DF" />
          <path d="M55 106L52 124M101 106L104 124" stroke="#D99750" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="52" cy="130" rx="14" ry="8" fill="#FFF4DF" />
          <ellipse cx="104" cy="130" rx="14" ry="8" fill="#FFF4DF" />
          <g className="pet-head">
            <path d="M36 53C33 43 34 27 40 27C46 26 57 35 63 41Q78 35 94 41C101 35 111 26 117 28C123 32 124 45 120 56C130 69 132 84 123 95C113 109 94 113 78 113C59 113 38 108 29 95C20 82 24 67 36 53Z" fill="#ECAF68" />
            <path d="M26 83C30 73 44 74 57 82C66 87 69 77 79 78C90 77 92 87 102 82C115 73 127 75 129 84C127 103 105 113 78 113C51 113 29 103 26 83Z" fill="#FFF4DF" />
            <g className="pet-eyes" fill="#285447">
              <ellipse cx="57" cy="68" rx="4.5" ry="5.5" />
              <ellipse cx="99" cy="68" rx="4.5" ry="5.5" />
            </g>
            <g className="pet-smile-eyes" stroke="#285447" strokeWidth="3" strokeLinecap="round">
              <path d="M52 69Q57 62 62 69M94 69Q99 62 104 69" />
            </g>
            <path d="M71 84C70 80 87 80 86 84C85 88 80 92 78 92C76 92 72 88 71 84Z" fill="#285447" />
          </g>
          <path d="M59 108Q78 116 97 108L91 121L78 127L64 120Z" fill="#C4D6BE" />
          <circle cx="78" cy="117" r="2.2" fill="#38654F" />
        </g>
        <g className="pet-thoughts" fill="#729262">
          <circle cx="127" cy="49" r="2.5" /><circle cx="136" cy="39" r="3" /><circle cx="145" cy="28" r="4" />
        </g>
        <g className="pet-state-badge"><circle cx="134" cy="33" r="15" fill={activity === "attention" ? "#B57423" : "#38654F"}/>{activity === "completed" ? <path d="m127 33 5 5 9-10" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/> : <path d="M134 25v10m0 6h.01" stroke="white" strokeWidth="3" strokeLinecap="round"/>}</g>
        <path className="pet-heart" d="M128 27C119 20 112 30 117 35L128 44L139 35C144 30 137 20 128 27Z" fill="#D99750" />
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
      type="button"
      className={className}
      aria-label={`摸摸 ${preferences.name} 柴犬`}
      title={activity === "idle" ? "摸摸我" : label}
      onClick={greet}
    >
      {artwork}
    </button>
  ) : (
    <span
      className={className}
      role="img"
      aria-label={activity === "idle" ? "Ailo 柴犬" : label}
      title={label}
    >
      {artwork}
    </span>
  );
}
