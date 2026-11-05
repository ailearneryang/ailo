// React 19 callback ref: install once per conversation and clean up on unmount.
export function attachChatScroll(viewport:HTMLDivElement|null){
 if(!viewport)return;
 let following=true,inspectingDetails=false,lastScrollTop=viewport.scrollTop;
 const atBottom=()=>viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop<=32;
 const follow=()=>{if(following){viewport.scrollTop=viewport.scrollHeight;lastScrollTop=viewport.scrollTop;}};
 const onScroll=()=>{const top=viewport.scrollTop;if(top<lastScrollTop)following=false;else if(top>lastScrollTop&&atBottom())following=true;lastScrollTop=top;};
 // Pause before the browser applies the wheel movement, even if content grows in the same frame.
 const onDetailsInteraction=(event:Event)=>{if((event.target as Element)?.closest?.('summary')){following=false;inspectingDetails=true;}};
 const onDetailsToggle=(event:Event)=>{const details=event.target as HTMLDetailsElement,interacted=inspectingDetails;inspectingDetails=false;if(!interacted||!details.open||!details.matches?.('.reply-details,.task-activity-details'))return;following=false;const summary=details.querySelector('summary');if(summary){const top=summary.getBoundingClientRect().top-viewport.getBoundingClientRect().top;viewport.scrollTop+=top-20;} };
 const onWheel=(event:WheelEvent)=>{if(event.deltaY<0)following=false;};
 const onLatest=()=>{following=true;inspectingDetails=false;follow();};
 const onKey=(event:KeyboardEvent)=>{if(['ArrowUp','PageUp','Home'].includes(event.key))following=false;};
 let touchY:number|undefined;
 const onTouchStart=(event:TouchEvent)=>{touchY=event.touches[0]?.clientY;};
 const onTouchMove=(event:TouchEvent)=>{const y=event.touches[0]?.clientY;if(y!==undefined&&touchY!==undefined&&y>touchY)following=false;touchY=y;};
 viewport.addEventListener('ailo-follow-latest',onLatest);
 viewport.addEventListener('keydown',onKey);
 viewport.addEventListener('touchstart',onTouchStart,{passive:true});
 viewport.addEventListener('touchmove',onTouchMove,{passive:true});
 viewport.addEventListener('pointerdown',onDetailsInteraction,true);
 viewport.addEventListener('click',onDetailsInteraction,true);
 viewport.addEventListener('toggle',onDetailsToggle,true);
 viewport.addEventListener('scroll',onScroll,{passive:true});
 viewport.addEventListener('wheel',onWheel,{passive:true});
 const observer=new ResizeObserver(follow);
 observer.observe(viewport);
 const content=viewport.querySelector('.thread-content');
 if(content)observer.observe(content);
 follow();
 return ()=>{
  observer.disconnect();
  viewport.removeEventListener('ailo-follow-latest',onLatest);
  viewport.removeEventListener('keydown',onKey);
  viewport.removeEventListener('touchstart',onTouchStart);
  viewport.removeEventListener('touchmove',onTouchMove);
  viewport.removeEventListener('pointerdown',onDetailsInteraction,true);
  viewport.removeEventListener('click',onDetailsInteraction,true);
  viewport.removeEventListener('toggle',onDetailsToggle,true);
  viewport.removeEventListener('scroll',onScroll);
  viewport.removeEventListener('wheel',onWheel);
 };
}
