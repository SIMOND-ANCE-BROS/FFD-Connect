import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { createLogger } from "../../../utils/logger";
import { ClubMember, ClubService } from "../services/ClubService";

const logger = createLogger("useClubMembersLogic");

export const useClubMembersLogic = () => {
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchMembers = async () => {
    setIsLoading(true);
    try {
      const data = await ClubService.getMembers();
      setMembers(data);
    } catch (error) {
      logger.error("Failed to fetch members", error);
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchMembers().catch(() => {});
    }, []),
  );

  const filteredMembers = members.filter((m) => {
    const query = searchQuery.toLowerCase();
    const fullName = `${m.firstName} ${m.lastName}`.toLowerCase();
    const license = m.license?.number?.toLowerCase() ?? "";

    return fullName.includes(query) || license.includes(query);
  });

  return {
    members: filteredMembers,
    isLoading,
    searchQuery,
    setSearchQuery,
    refresh: fetchMembers,
  };
};
