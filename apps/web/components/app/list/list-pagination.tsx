"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { paginationButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

type ListPaginationProps = {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  className?: string;
};

export function ListPagination({
  page,
  totalPages,
  total,
  onPageChange,
  disabled = false,
  className,
}: ListPaginationProps) {
  const t = usePlatformT();

  if (totalPages <= 1) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-t border-slate-800/80 pt-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-sm font-medium text-slate-400">
        {t("common.pageOf", { page, total: totalPages })}
        {total !== undefined ? ` · ${total} ${t("common.total")}` : null}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={disabled || page <= 1}
          className={paginationButtonClass(page <= 1 || disabled)}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          {t("common.prev")}
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={disabled || page >= totalPages}
          className={paginationButtonClass(page >= totalPages || disabled)}
        >
          {t("common.next")}
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
