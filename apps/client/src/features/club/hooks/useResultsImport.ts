import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportResultsReportDto } from "../../../api/generated/types.gen";
import {
  importCompetitionResults,
  isResultsCsvTooLarge,
  type ResultsImportLineError,
} from "../services/resultsImportApi";

export interface ResultsImportFailure {
  message: string;
  errors: ResultsImportLineError[];
}

/**
 * State of the results import screen (#690): « Vérifier » runs a dry run,
 * « Importer » is only offered once the very same text passed the check.
 * Editing the text discards the previous check, failure and report.
 */
export function useResultsImport(competitionId: string) {
  const [csv, setCsvState] = useState("");
  const [checkedCsv, setCheckedCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResultsReportDto | null>(null);
  const [report, setReport] = useState<ImportResultsReportDto | null>(null);
  const [failure, setFailure] = useState<ResultsImportFailure | null>(null);
  const [busy, setBusy] = useState<"checking" | "importing" | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setCsv = useCallback((text: string) => {
    setCsvState(text);
    setCheckedCsv(null);
    setPreview(null);
    setReport(null);
    setFailure(null);
  }, []);

  const run = useCallback(
    async (dryRun: boolean) => {
      const text = csv;
      setFailure(null);
      setReport(null);
      if (dryRun) setPreview(null);
      setBusy(dryRun ? "checking" : "importing");
      const outcome = await importCompetitionResults(competitionId, text, {
        dryRun,
      });
      if (!mounted.current) return;
      setBusy(null);
      if (!outcome.ok) {
        setFailure({ message: outcome.message, errors: outcome.errors });
        setCheckedCsv(null);
        setPreview(null);
        return;
      }
      if (dryRun) {
        setPreview(outcome.report);
        setCheckedCsv(text);
      } else {
        setPreview(null);
        setCheckedCsv(null);
        setReport(outcome.report);
      }
    },
    [competitionId, csv],
  );

  const check = useCallback(() => run(true), [run]);

  const confirmImport = useCallback(async () => {
    if (checkedCsv === null || checkedCsv !== csv) return;
    await run(false);
  }, [checkedCsv, csv, run]);

  const isEmpty = csv.trim() === "";

  return {
    csv,
    setCsv,
    check,
    confirmImport,
    preview,
    report,
    failure,
    busy,
    isEmpty,
    tooLarge: isResultsCsvTooLarge(csv),
    canCheck: !isEmpty && busy === null,
    canImport:
      preview !== null && checkedCsv === csv && !isEmpty && busy === null,
  };
}
