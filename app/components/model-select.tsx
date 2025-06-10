import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, Bot, Loader2 } from "lucide-react";
import { Modal } from "./ui-lib";
import { IconButton } from "./button";
import ResourceCard from "./resource-card";
import { useHyphaStore, Resource } from "../store/hypha";

import style from "./model-select.module.scss";
import Locale from "../locales";

export interface AgentSelectProps {
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
  selectedAgent?: string;
}

interface SearchInputProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

const SearchInput: React.FC<SearchInputProps> = ({
  searchTerm,
  setSearchTerm,
  inputRef,
}) => {
  return (
    <div className={style["input-container"]}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Search agents..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className={style["input"]}
      />
      <Search className={style["input-icon"]} />
    </div>
  );
};

const LoadingSpinner = () => (
  <div className={style["loading-container"]}>
    <Loader2 className={style["loading-spinner"]} />
    <span className={style["loading-text"]}>Loading agents...</span>
  </div>
);

const EmptyState = ({ searchTerm }: { searchTerm: string }) => (
  <div className={style["empty-state"]}>
    <Bot className={style["empty-icon"]} />
    <h3 className={style["empty-title"]}>
      {searchTerm ? "No agents found" : "No agents available"}
    </h3>
    <p className={style["empty-description"]}>
      {searchTerm
        ? `Try adjusting your search term "${searchTerm}"`
        : "There are no agents available at the moment."}
    </p>
  </div>
);

const AgentSelect: React.FC<AgentSelectProps> = ({
  onClose,
  onSelectAgent,
  selectedAgent,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    selectedAgent || null,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { resources, fetchResources, totalItems, itemsPerPage } =
    useHyphaStore();

  // Debounced search
  const debouncedSearch = useCallback((query: string) => {
    const timer = setTimeout(() => {
      setPage(1);
      loadAgents(1, query);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const loadAgents = useCallback(
    async (pageNum: number, searchQuery?: string) => {
      try {
        setLoading(true);
        await fetchResources(pageNum, searchQuery);
      } catch (error) {
        console.error("Failed to fetch agents:", error);
      } finally {
        setLoading(false);
      }
    },
    [fetchResources],
  );

  useEffect(() => {
    loadAgents(1);
  }, [loadAgents]);

  useEffect(() => {
    const cleanup = debouncedSearch(searchTerm);
    return cleanup;
  }, [searchTerm, debouncedSearch]);

  useEffect(() => {
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }, []);

  const handleAgentSelect = (agentId: string) => {
    setSelectedAgentId(agentId);
  };

  const handleConfirmSelection = () => {
    if (selectedAgentId) {
      onSelectAgent(selectedAgentId);
      onClose();
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadAgents(nextPage, searchTerm);
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const hasMore = page < totalPages;

  // Filter agents to only show type 'agent'
  const agentResources = resources.filter((resource) =>
    resource.manifest.type?.includes("agent"),
  );

  return (
    <div className="screen-model-container">
      <Modal title="Select Agent" onClose={onClose}>
        <div className={style["header"]}>
          <SearchInput
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            inputRef={searchInputRef}
          />
        </div>

        <div className={style["agent-list-container"]}>
          {loading && page === 1 ? (
            <LoadingSpinner />
          ) : agentResources.length === 0 ? (
            <EmptyState searchTerm={searchTerm} />
          ) : (
            <div className={style["agent-grid"]}>
              {agentResources.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  onSelect={handleAgentSelect}
                  isSelected={selectedAgentId === resource.id}
                />
              ))}
            </div>
          )}

          {/* Load More Button */}
          {hasMore && !loading && agentResources.length > 0 && (
            <div className={style["load-more-container"]}>
              <button
                onClick={handleLoadMore}
                className={style["load-more-button"]}
              >
                Load More
              </button>
            </div>
          )}

          {/* Loading indicator for load more */}
          {loading && page > 1 && (
            <div className={style["loading-more"]}>
              <Loader2 className={style["loading-more-spinner"]} />
              <span className={style["loading-more-text"]}>
                Loading more agents...
              </span>
            </div>
          )}
        </div>

        {/* Footer with selection actions */}
        <div className={style["footer"]}>
          <div className={style["selection-info"]}>
            {selectedAgentId ? (
              <span>
                Selected:{" "}
                {agentResources.find((r) => r.id === selectedAgentId)?.manifest
                  .name || selectedAgentId}
              </span>
            ) : (
              <span>No agent selected</span>
            )}
          </div>
          <div className={style["footer-actions"]}>
            <IconButton
              text="Cancel"
              onClick={onClose}
              className={style["cancel-button"]}
            />
            <IconButton
              text="Select"
              onClick={handleConfirmSelection}
              disabled={!selectedAgentId}
              className={`${style["select-button"]} ${!selectedAgentId ? style["disabled"] : ""}`}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AgentSelect;
