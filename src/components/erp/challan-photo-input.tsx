import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CHALLAN_PHOTO_ACCEPT, validateChallanPhoto } from "@/lib/challan-photo";

type Props = {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
};

export function ChallanPhotoInput({ file, onChange, disabled = false }: Props) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (selected: File | null) => {
    if (!selected) return;
    try {
      validateChallanPhoto(selected);
      onChange(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid challan photo");
    }
  };

  return (
    <section className="rounded-xl border bg-muted/20 p-3 sm:col-span-2" aria-label="Challan photo required">
      <div className="mb-1 text-sm font-semibold">Supplier challan photo <span className="text-destructive">*</span></div>
      <p className="mb-3 text-xs text-muted-foreground">
        Mandatory for every new challan. Take a clear picture showing the challan number,
        date and materials, or choose an existing JPG/PNG image (maximum 10 MB).
        The photo is kept private.
      </p>
      <input
        ref={camera}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take challan photo with camera"
        disabled={disabled}
        onChange={(event) => {
          choose(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={gallery}
        className="sr-only"
        type="file"
        accept={CHALLAN_PHOTO_ACCEPT}
        aria-label="Choose challan photo from gallery"
        disabled={disabled}
        onChange={(event) => {
          choose(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => camera.current?.click()}>
          <Camera className="mr-2 size-4" aria-hidden="true" />Take photo
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => gallery.current?.click()}>
          <ImagePlus className="mr-2 size-4" aria-hidden="true" />Choose photo
        </Button>
        {file && (
          <Button type="button" size="sm" variant="ghost" disabled={disabled}
            onClick={() => onChange(null)}>
            <Trash2 className="mr-2 size-4" aria-hidden="true" />Remove
          </Button>
        )}
      </div>
      {file && preview ? (
        <div className="mt-3 rounded-lg border bg-background p-2">
          <img src={preview} alt="Selected supplier challan photo" className="mx-auto max-h-64 w-auto max-w-full rounded object-contain" />
          <p className="mt-2 break-all text-xs text-muted-foreground">{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-destructive" role="status">
          Photo missing — registration is disabled until you attach one.
        </p>
      )}
    </section>
  );
}
