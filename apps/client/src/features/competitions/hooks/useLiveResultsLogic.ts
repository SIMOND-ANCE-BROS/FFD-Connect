import { useCallback, useEffect, useState } from "react";
import { createLogger } from "../../../utils/logger";
import {
  Result,
  useCompetitionRepository,
} from "../context/CompetitionContext";

const logger = createLogger("useLiveResultsLogic");

export type ResultSection = {
  title: string;
  data: Result[];
};

interface UseLiveResultsLogicProps {
  competitionId: string;
}

const getRoundPriority = (round: string) => {
  const r = round.toLowerCase();
  if (r.includes("demi")) return 1;
  if (r.includes("quart")) return 2;
  if (r.includes("8e")) return 3;
  if (r.includes("16e")) return 4;
  if (r.includes("final")) return 0;
  return 5;
};

export const useLiveResultsLogic = ({
  competitionId,
}: UseLiveResultsLogicProps) => {
  const { getResults } = useCompetitionRepository();
  const [sections, setSections] = useState<ResultSection[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const groupAndSortResults = useCallback((data: Result[]) => {
    const grouped = data.reduce(
      (acc, curr) => {
        const round = curr.round;
        acc[round] ??= [];
        acc[round].push(curr);
        return acc;
      },
      {} as Record<string, Result[]>,
    );

    const resultSections: ResultSection[] = Object.keys(grouped).map((key) => ({
      title: key,
      data: grouped[key].sort((a, b) => a.ranking - b.ranking),
    }));

    resultSections.sort(
      (a, b) => getRoundPriority(a.title) - getRoundPriority(b.title),
    );
    return resultSections;
  }, []);

  const loadResults = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await getResults(competitionId);
      setSections(groupAndSortResults(data));
    } catch (e) {
      logger.error("Failed to load results", e);
    } finally {
      setRefreshing(false);
    }
  }, [competitionId, getResults, groupAndSortResults]);

  useEffect(() => {
    loadResults().catch(() => {});
    const interval = setInterval(() => {
      loadResults().catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [loadResults]);

  const eventLabel =
    sections.length > 0 && sections[0].data.length > 0
      ? `${sections[0].data[0].event?.category} - ${sections[0].data[0].event?.level}`.toUpperCase()
      : "";

  return {
    state: {
      sections,
      refreshing,
      eventLabel,
    },
    actions: {
      loadResults,
    },
  };
};
