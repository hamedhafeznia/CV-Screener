'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/copy';

/**
 * The seven primitives from PRD §8.4, kept in one file.
 *
 * Radix does the work worth not writing — focus trapping and escape handling in
 * Dialog, the image/fallback swap in Avatar, cross-browser scrollbars in
 * ScrollArea. Button, Badge, Card and Textarea are a few classes each; a
 * generated component library for them would be more code than it saves.
 */

/* ---------------------------------------------------------------- Button --- */

type ButtonVariant = 'default' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The only saturated element on the page, and only ever the send button.
  default: 'bg-accent text-black hover:opacity-88',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
  outline: 'bg-surface text-text hover:bg-surface-2',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
  icon: 'size-9',
};

export function Button({
  className,
  variant = 'default',
  size = 'md',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors',
        'focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-faint',
        'disabled:pointer-events-none disabled:opacity-35',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------- Textarea --- */

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full resize-none bg-transparent text-base leading-6 text-text outline-none',
          'placeholder:text-faint disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

/* ------------------------------------------------------------------ Card --- */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius)] bg-surface', className)} {...props} />;
}

/* ----------------------------------------------------------------- Badge --- */

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-surface-2 px-1.5 py-0.5',
        'font-mono text-xs leading-none text-faint',
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- Avatar --- */

export function Avatar({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <AvatarPrimitive.Root
      className={cn('relative flex size-7 shrink-0 overflow-hidden rounded-full bg-surface-2', className)}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-[10px] font-medium text-faint">
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/* ------------------------------------------------------------ ScrollArea --- */

export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('overflow-hidden', className)} type="hover">
      {/* Radix's viewport wraps children in a `display: table` div, which sizes to
          content and lets long rows overflow horizontally. Force it back to block. */}
      <ScrollAreaPrimitive.Viewport className="size-full [&>div]:!block">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-0.5 transition-opacity"
      >
        <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

/* ---------------------------------------------------------------- Dialog --- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          // Full-bleed on a phone — a PDF in a 94vw box with rounded corners
          // wastes the only screen space that matters.
          'fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg',
          'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[92vh] sm:w-[min(920px,94vw)]',
          'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-lg)]',
          'sm:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.9)] sm:outline sm:outline-1 sm:-outline-offset-1 sm:outline-border',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-sm text-text">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="truncate font-mono text-xs text-faint">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label={COPY.pdf.close}>
              <X className="size-4" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
