import { useEffect } from 'react';

/** Closes menus on outside click / Escape. */
export function useClickOutside(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;

    function onPointerDown(event) {
      if (!ref.current) return;
      if (ref.current.contains(event.target)) return;
      handler(event);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') handler(event);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, handler, active]);
}

export default useClickOutside;
