import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-foreground text-background',
        secondary:
          'border-border bg-secondary text-secondary-foreground',
        outline:
          'border-border bg-background text-muted-foreground',
        meta:
          'border-[color:var(--meta-blue-soft)] bg-[color:var(--meta-blue-faint)] text-[color:var(--meta-blue)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type BadgeProps = React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants>

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  )
}

export { Badge, badgeVariants }
