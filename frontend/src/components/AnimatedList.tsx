import type { ReactNode } from 'react';
import { mergeRefs, useListAnimation } from '../lib/motion';

/**
 * A <ul> whose rows animate: new rows fade and drop in, removed rows slide out, the rest glide to their new
 * places. `innerRef` lets a drop target (dnd-kit) share the element.
 */
export function AnimatedList({
  className,
  children,
  innerRef,
  label,
}: {
  className?: string;
  children: ReactNode;
  innerRef?: (el: HTMLUListElement | null) => void;
  label?: string;
}) {
  const animate = useListAnimation<HTMLUListElement>();
  return (
    <ul ref={innerRef ? mergeRefs(innerRef, animate) : animate} className={className} aria-label={label}>
      {children}
    </ul>
  );
}
