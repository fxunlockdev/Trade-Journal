"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CsvUploadProps {
  readonly onFileSelected: (file: File) => void;
}

export function CsvUpload({ onFileSelected }: CsvUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSelect = useCallback(
    (file: File) => {
      setError(null);

      if (!file.name.endsWith(".csv")) {
        setError("Only .csv files are accepted");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError("File size must be under 10MB");
        return;
      }

      setSelectedFile(file);
      onFileSelected(file);
    },
    [onFileSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        validateAndSelect(file);
      }
    },
    [validateAndSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        validateAndSelect(file);
      }
    },
    [validateAndSelect],
  );

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-all",
          dragging
            ? "border-emerald-500 bg-emerald-500/5"
            : "border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={handleInputChange}
          className="hidden"
        />

        {selectedFile ? (
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-8 w-8 text-emerald-400" />
            <div>
              <p className="font-medium text-zinc-100">{selectedFile.name}</p>
              <p className="text-xs text-zinc-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-300">
              Drop your CSV file here or click to browse
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Supports MT5 trade history exports (.csv)
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
