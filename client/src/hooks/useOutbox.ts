import { useEffect, useState } from "react";
import { getOutbox, subscribe } from "@/lib/syncEngine";
import type { OutboxItem } from "@/lib/offlineDb";

export function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getOutbox().then((i) => {
        if (!cancelled) setItems(i);
      });
    };
    refresh();
    const unsubscribe = subscribe(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return {
    items,
    pending: items.filter((i) => i.status === "pending" || i.status === "syncing"),
    needsReview: items.filter((i) => i.status === "needs_review"),
  };
}
