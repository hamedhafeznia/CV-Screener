'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  default: 'bg-accent text-white hover:opacity-90',
  ghost: 'hover:bg-surface-2 text-text',
  outline: 'border border-border bg-bg hover:bg-surface text-text',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
  icon: 'h-9 w-9',
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
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius)] font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
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
          'placeholder:text-muted disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

/* ------------------------------------------------------------------ Card --- */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius)] border border-border bg-surface', className)} {...props} />;
}

/* ----------------------------------------------------------------- Badge --- */

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-2 px-1.5 py-0.5',
        'font-mono text-xs leading-none text-muted',
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
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full bg-surface-2', className)}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-xs font-medium text-muted">
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/* ------------------------------------------------------------ ScrollArea --- */

export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('overflow-hidden', className)} type="hover">
      <ScrollAreaPrimitive.Viewport className="size-full">{children}</ScrollAreaPrimitive.Viewport>
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
          'fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(920px,94vw)] -translate-x-1/2 -translate-y-1/2',
          'flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-bg shadow-2xl',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-sm font-medium text-text">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="truncate font-mono text-xs text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X className="size-4" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
