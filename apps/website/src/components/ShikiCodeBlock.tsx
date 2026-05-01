import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

type ShikiCodeBlockProps = {
  code: string;
  language: string;
};

export function ShikiCodeBlock({ code, language }: ShikiCodeBlockProps) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    void codeToHtml(code || " ", {
      lang: language || "text",
      theme: "github-dark",
    })
      .then((value) => {
        if (!cancelled) {
          setHtml(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!html) {
    return null;
  }

  return (
    <div
      className="mt-3 overflow-x-auto rounded text-sm"
      // Shiki returns escaped highlighted HTML for code input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
