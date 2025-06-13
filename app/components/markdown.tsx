import ReactMarkdown from "react-markdown";
import "katex/dist/katex.min.css";
import RemarkMath from "remark-math";
import RemarkBreaks from "remark-breaks";
import RehypeKatex from "rehype-katex";
import RemarkGfm from "remark-gfm";
import RehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { useRef, useState, RefObject, useEffect, useMemo } from "react";
import { copyToClipboard } from "../utils";
import mermaid from "mermaid";

import LoadingIcon from "../icons/three-dots.svg";
import React from "react";
import { useDebouncedCallback } from "use-debounce";
import { showImageModal } from "./ui-lib";
import { PluggableList } from "react-markdown/lib";

export function Mermaid(props: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (props.code && ref.current) {
      mermaid
        .run({
          nodes: [ref.current],
          suppressErrors: true,
        })
        .catch((e) => {
          setHasError(true);
          console.error("[Mermaid] ", e.message);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.code]);

  function viewSvgInNewWindow() {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const text = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([text], { type: "image/svg+xml" });
    showImageModal(URL.createObjectURL(blob));
  }

  if (hasError) {
    return null;
  }

  return (
    <div
      className="no-dark mermaid"
      style={{
        cursor: "pointer",
        overflow: "auto",
      }}
      ref={ref}
      onClick={() => viewSvgInNewWindow()}
    >
      {props.code}
    </div>
  );
}

export const PreCode = (props: { children: any }) => {
  const ref = useRef<HTMLPreElement>(null);
  const refText = ref.current?.innerText;
  const [mermaidCode, setMermaidCode] = useState("");

  const renderMermaid = useDebouncedCallback(() => {
    if (!ref.current) return;
    const mermaidDom = ref.current.querySelector("code.language-mermaid");
    if (mermaidDom) {
      setMermaidCode((mermaidDom as HTMLElement).innerText);
    }
  }, 600);

  useEffect(() => {
    setTimeout(renderMermaid, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refText]);

  return (
    <>
      {mermaidCode.length > 0 && (
        <Mermaid code={mermaidCode} key={mermaidCode} />
      )}
      <pre ref={ref}>
        <span
          className="copy-code-button"
          onClick={() => {
            if (ref.current) {
              const code = ref.current.innerText;
              copyToClipboard(code);
            }
          }}
        ></span>
        {props.children}
      </pre>
    </>
  );
};

function escapeDollarNumber(text: string) {
  let escapedText = "";

  for (let i = 0; i < text.length; i += 1) {
    let char = text[i];
    const nextChar = text[i + 1] || " ";

    if (char === "$" && nextChar >= "0" && nextChar <= "9") {
      char = "\\$";
    }

    escapedText += char;
  }

  return escapedText;
}

function escapeBrackets(text: string) {
  const pattern =
    /(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g;
  return text.replace(
    pattern,
    (match, codeBlock, squareBracket, roundBracket) => {
      if (codeBlock) {
        return codeBlock;
      } else if (squareBracket) {
        return `$$${squareBracket}$$`;
      } else if (roundBracket) {
        return `$${roundBracket}$`;
      }
      return match;
    },
  );
}

function _MarkDownContent(props: { content: string }) {
  const escapedContent = useMemo(() => {
    return escapeBrackets(escapeDollarNumber(props.content));
  }, [props.content]);

  return (
    <ReactMarkdown
      remarkPlugins={[RemarkMath, RemarkGfm, RemarkBreaks] as PluggableList}
      rehypePlugins={
        [
          rehypeRaw, // Allow HTML tags like <details> and <summary>
          RehypeKatex,
          [
            RehypeHighlight,
            {
              detect: true,
              ignoreMissing: true,
            },
          ],
        ] as PluggableList
      }
      components={
        {
          pre: PreCode as any,
          p: (pProps: any) => <p {...pProps} dir="auto" />,
          a: (aProps: any) => {
            const href = aProps.href || "";
            const isInternal = /^\/#/i.test(href);
            const target = isInternal ? "_self" : aProps.target ?? "_blank";
            return <a {...aProps} target={target} />;
          },
          // Custom renderer for <thoughts> tag
          thoughts: (props: any) => (
            <span
              className="thoughts-container"
              style={{
                display: "block",
                backgroundColor: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
                padding: "12px 16px",
                margin: "16px 0",
                fontStyle: "italic",
                opacity: 0.8,
                position: "relative",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: "bold",
                  color: "var(--color-fg-muted)",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                💭 Thoughts
              </span>
              <span style={{ display: "block" }} {...props} />
            </span>
          ),
          // Custom renderer for <thinking> tag (similar to thoughts)
          thinking: (props: any) => (
            <span
              className="thinking-container"
              style={{
                display: "block",
                backgroundColor: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
                padding: "12px 16px",
                margin: "16px 0",
                fontStyle: "italic",
                opacity: 0.8,
                borderLeft: "4px solid var(--color-accent-fg)",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: "bold",
                  color: "var(--color-fg-muted)",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                🤔 Thinking
              </span>
              <span style={{ display: "block" }} {...props} />
            </span>
          ),
          // Custom renderer for <py-script> tag
          "py-script": (props: any) => {
            const content = props.children || "";
            return (
              <div
                className="py-script-container"
                style={{
                  display: "block",
                  margin: "16px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    color: "var(--color-fg-muted)",
                    marginBottom: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  🐍 Python Script
                </div>
                <PreCode>
                  <code className="language-python">{content}</code>
                </PreCode>
              </div>
            );
          },
          // Custom renderer for <t-script> tag
          "t-script": (props: any) => {
            const content = props.children || "";
            return (
              <div
                className="t-script-container"
                style={{
                  display: "block",
                  margin: "16px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    color: "var(--color-fg-muted)",
                    marginBottom: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  📘 TypeScript
                </div>
                <PreCode>
                  <code className="language-typescript">{content}</code>
                </PreCode>
              </div>
            );
          },
          // Custom renderer for <javascript> tag
          javascript: (props: any) => {
            const content = props.children || "";
            return (
              <div
                className="javascript-container"
                style={{
                  display: "block",
                  margin: "16px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    color: "var(--color-fg-muted)",
                    marginBottom: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  💛 JavaScript
                </div>
                <PreCode>
                  <code className="language-javascript">{content}</code>
                </PreCode>
              </div>
            );
          },
          // Custom renderer for <returnToUser> tag
          returntouser: (props: any) => (
            <span
              className="return-to-user-container"
              style={{
                display: "block",
                backgroundColor: "var(--color-success-subtle)",
                border: "2px solid var(--color-success-emphasis)",
                borderRadius: "12px",
                padding: "16px 20px",
                margin: "20px 0",
                position: "relative",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  fontWeight: "bold",
                  color: "var(--color-success-fg)",
                  marginBottom: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                📋 Response
              </span>
              <span
                style={{
                  display: "block",
                  color: "var(--color-fg-default)",
                  lineHeight: "1.6",
                }}
                {...props}
              />
            </span>
          ),
        } as any
      }
    >
      {escapedContent}
    </ReactMarkdown>
  );
}

export const MarkdownContent = React.memo(_MarkDownContent);

export function Markdown(
  props: {
    content: string;
    loading?: boolean;
    fontSize?: number;
    parentRef?: RefObject<HTMLDivElement>;
    defaultShow?: boolean;
  } & React.DOMAttributes<HTMLDivElement>,
) {
  const mdRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="markdown-body"
      style={{
        fontSize: `${props.fontSize ?? 14}px`,
      }}
      ref={mdRef}
      onContextMenu={props.onContextMenu}
      onDoubleClickCapture={props.onDoubleClickCapture}
      dir="auto"
    >
      {props.loading ? (
        <LoadingIcon />
      ) : (
        <MarkdownContent content={props.content} />
      )}
    </div>
  );
}
