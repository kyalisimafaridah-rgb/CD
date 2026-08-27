import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  className?: string;
};

/**
 * Consistent empty state used across Patients, Visits, Billing, Inventory,
 * Appointments, etc. Designed for clinic staff with varying digital literacy:
 * large icon, plain language, and a clear next-step button.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-green-50 text-green-700 size-14 rounded-xl">
          <Icon className="size-7" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {(actionLabel || secondaryLabel) && (
        <EmptyContent>
          <div className="flex flex-col sm:flex-row gap-2 w-full justify-center">
            {actionLabel && onAction && (
              <Button
                onClick={onAction}
                className="bg-green-600 hover:bg-green-700"
                size="lg"
              >
                {actionLabel}
              </Button>
            )}
            {secondaryLabel && onSecondary && (
              <Button variant="outline" onClick={onSecondary} size="lg">
                {secondaryLabel}
              </Button>
            )}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}
