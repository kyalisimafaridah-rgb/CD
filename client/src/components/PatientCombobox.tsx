import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PatientOption = {
  id: number;
  firstName: string;
  lastName?: string | null;
  patientId: string;
  phone?: string | null;
};

/**
 * A plain <Select> with hundreds of patients in it is unusable — you can't
 * type to filter, only scroll. This wraps the existing cmdk/popover
 * primitives (already in the project, just never assembled into a
 * combobox) into a type-to-search patient picker.
 */
export function PatientCombobox({
  patients,
  value,
  onChange,
  placeholder = "Search patient by name or ID...",
}: {
  patients: PatientOption[] | undefined;
  value: string;
  onChange: (patientId: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = patients?.find((p) => String(p.id) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected
            ? `${selected.firstName} ${selected.lastName || ""} — ${selected.patientId}`
            : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Type a name, ID, or phone..." />
          <CommandList>
            <CommandEmpty>No patient found.</CommandEmpty>
            <CommandGroup>
              {patients?.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.firstName} ${p.lastName || ""} ${p.patientId} ${p.phone || ""}`}
                  onSelect={() => {
                    onChange(String(p.id));
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      String(p.id) === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {p.firstName} {p.lastName || ""} — {p.patientId}
                  {p.phone && <span className="ml-2 text-xs text-muted-foreground">{p.phone}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
