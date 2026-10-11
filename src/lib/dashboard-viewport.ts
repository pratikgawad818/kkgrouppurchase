/** Lazy-load secondary dashboard sections without affecting authorization. */
export function watchDashboardSection(node: Element, activate: () => void,
  ObserverCtor: typeof IntersectionObserver | undefined =
    typeof IntersectionObserver === "undefined" ? undefined : IntersectionObserver): () => void {
  if (!ObserverCtor) { activate(); return () => {}; }
  let stopped=false, activated=false;
  const observer=new ObserverCtor(entries=>{
    if(stopped||activated||!entries.some(e=>e.isIntersecting))return;
    activated=true;observer.disconnect();activate();
  },{rootMargin:"320px 0px",threshold:0});
  observer.observe(node);
  return ()=>{stopped=true;observer.disconnect();};
}
