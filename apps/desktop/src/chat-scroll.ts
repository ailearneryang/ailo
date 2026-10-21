// React 19 callback ref: install once per conversation and clean up on unmount.
export function attachChatScroll(viewport:HTMLDivElement|null){
 if(!viewport)return;
 let following=true;
 const atBottom=()=>viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop<=32;
 const follow=()=>{if(following)viewport.scrollTop=viewport.scrollHeight;};
 const onScroll=()=>{following=atBottom();};
 // Pause before the browser applies the wheel movement, even if content grows in the same frame.
 const onWheel=(event:WheelEvent)=>{if(event.deltaY<0)following=false;};
 viewport.addEventListener('scroll',onScroll,{passive:true});
 viewport.addEventListener('wheel',onWheel,{passive:true});
 const observer=new ResizeObserver(follow);
 observer.observe(viewport);
 const content=viewport.querySelector('.thread-content');
 if(content)observer.observe(content);
 follow();
 return ()=>{
  observer.disconnect();
  viewport.removeEventListener('scroll',onScroll);
  viewport.removeEventListener('wheel',onWheel);
 };
}
