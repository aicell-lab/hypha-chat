import React from "react";
import { Resource } from "../store/hypha";

interface ResourceCardProps {
  resource: Resource;
  onSelect: (resourceId: string) => void;
  isSelected?: boolean;
}

const resolveHyphaUrl = (url: string, resourceId: string): string => {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  const baseUrl = "https://hypha.aicell.io/hypha-agents/artifacts";
  const resourcePath = resourceId.replace("hypha-agents/", "");

  if (url.startsWith("./")) {
    return `${baseUrl}/${resourcePath}/${url.slice(2)}`;
  }

  return `${baseUrl}/${resourcePath}/${url}`;
};

export const ResourceCard: React.FC<ResourceCardProps> = ({
  resource,
  onSelect,
  isSelected = false,
}) => {
  const covers = resource.manifest.covers || [];

  const getCurrentCoverUrl = () => {
    if (covers.length === 0) return "";
    return resolveHyphaUrl(covers[0], resource.id);
  };

  const handleClick = () => {
    onSelect(resource.id);
  };

  const cardStyles = {
    border: `2px solid ${isSelected ? "var(--primary)" : "var(--border-color)"}`,
    borderRadius: "8px",
    overflow: "hidden",
    cursor: "pointer",
    transition: "all 0.2s ease",
    backgroundColor: isSelected ? "var(--second)" : "var(--white)",
    boxShadow: isSelected
      ? "0 4px 12px rgba(0, 0, 0, 0.15)"
      : "0 2px 4px rgba(0, 0, 0, 0.1)",
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
  };

  const hoverStyles = {
    ":hover": {
      borderColor: "var(--primary)",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
      transform: "translateY(-2px)",
    },
  };

  return (
    <div
      style={cardStyles}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = "var(--primary)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
          e.currentTarget.style.transform = "translateY(-2px)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = "var(--border-color)";
          e.currentTarget.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.1)";
          e.currentTarget.style.transform = "translateY(0)";
        }
      }}
    >
      {/* Image/Icon Section */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "120px",
          backgroundColor: "var(--gray)",
          overflow: "hidden",
        }}
      >
        {covers.length > 0 ? (
          <img
            src={getCurrentCoverUrl()}
            alt={resource.manifest.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "var(--gray)",
            }}
          >
            {resource.manifest.icon ? (
              <img
                src={resource.manifest.icon}
                alt={resource.manifest.name}
                style={{
                  width: "48px",
                  height: "48px",
                  objectFit: "contain",
                }}
              />
            ) : resource.manifest.id_emoji ? (
              <span style={{ fontSize: "3rem" }}>
                {resource.manifest.id_emoji}
              </span>
            ) : (
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  backgroundColor: "var(--border-color)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "24px",
                }}
              >
                🤖
              </div>
            )}
          </div>
        )}

        {/* Selection indicator */}
        {isSelected && (
          <div
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              width: "24px",
              height: "24px",
              backgroundColor: "var(--primary)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              style={{ width: "16px", height: "16px", color: "white" }}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div
        style={{
          padding: "12px",
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <div style={{ flexShrink: 0, width: "24px" }}>
            {resource.manifest.icon ? (
              <img
                src={resource.manifest.icon}
                alt={resource.manifest.name}
                style={{ width: "24px", height: "24px", objectFit: "contain" }}
              />
            ) : resource.manifest.id_emoji ? (
              <span style={{ fontSize: "18px" }}>
                {resource.manifest.id_emoji}
              </span>
            ) : (
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  backgroundColor: "var(--border-color)",
                  borderRadius: "50%",
                }}
              />
            )}
          </div>
          <h3
            style={{
              fontSize: "14px",
              fontWeight: "500",
              color: "var(--text-color)",
              margin: 0,
              lineHeight: "1.2",
              flexGrow: 1,
              wordBreak: "break-word",
            }}
          >
            {resource.manifest.name}
          </h3>
        </div>

        <p
          style={{
            fontSize: "12px",
            color: "var(--text-color-2)",
            margin: "0 0 12px 0",
            lineHeight: "1.3",
            flexGrow: 1,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {resource.manifest.description}
        </p>

        {/* Tags */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px",
          }}
        >
          {resource.manifest.tags?.slice(0, 2).map((tag: string) => (
            <span
              key={tag}
              style={{
                padding: "2px 6px",
                backgroundColor: "var(--gray)",
                color: "var(--text-color-2)",
                fontSize: "10px",
                borderRadius: "4px",
                border: "1px solid var(--border-color)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ResourceCard;
