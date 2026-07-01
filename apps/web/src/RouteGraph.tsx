import React from "react";
import type { RouteView } from "./route-view.js";

interface RouteGraphProps {
  view: RouteView;
}

export function RouteGraph({ view }: RouteGraphProps) {
  const nodeRadius = 20;
  const nodeSpacing = 120;
  const svgWidth = Math.max(300, view.nodes.length * nodeSpacing + 60);
  const svgHeight = 120;

  return (
    <div style={{ marginBottom: "1rem" }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{
          background: "#f5f5f5",
          border: `2px solid ${view.color}`,
          borderRadius: "4px",
          display: "block",
        }}
      >
        {/* Edges (arrows) */}
        {view.edges.map((edge, i) => {
          const fromNode = view.nodes.find((n) => n.id === edge.from);
          const toNode = view.nodes.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const fromIdx = view.nodes.indexOf(fromNode);
          const toIdx = view.nodes.indexOf(toNode);
          const x1 = 30 + fromIdx * nodeSpacing;
          const x2 = 30 + toIdx * nodeSpacing;
          const y = 60;

          return (
            <g key={`edge-${i}`}>
              {/* Line */}
              <line
                x1={x1 + nodeRadius}
                y1={y}
                x2={x2 - nodeRadius}
                y2={y}
                stroke={view.color}
                strokeWidth={2}
              />
              {/* Arrow head */}
              <polygon
                points={`${x2 - nodeRadius},${y} ${x2 - nodeRadius - 8},${y - 5} ${x2 - nodeRadius - 8},${y + 5}`}
                fill={view.color}
              />
              {/* Edge label */}
              <text
                x={(x1 + x2) / 2}
                y={y - 10}
                textAnchor="middle"
                fontSize="12"
                fill="#333"
              >
                {edge.label}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {view.nodes.map((node, i) => {
          const x = 30 + i * nodeSpacing;
          const y = 60;
          const isSource = node.role === "source";
          const isTarget = node.role === "target";
          const isHop = node.role === "hop";

          return (
            <g key={`node-${i}`}>
              <circle
                cx={x}
                cy={y}
                r={nodeRadius}
                fill={isSource ? "#e8f5e9" : isTarget ? "#ffebee" : "#fff9c4"}
                stroke={view.color}
                strokeWidth={2}
              />
              <text
                x={x}
                y={y + 5}
                textAnchor="middle"
                fontSize="11"
                fontWeight="bold"
                fill="#333"
              >
                {isSource ? "S" : isTarget ? "T" : isHop ? `H${i - 1}` : "?"}
              </text>
              <text
                x={x}
                y={y + 35}
                textAnchor="middle"
                fontSize="10"
                fill="#666"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Reasons (if any) */}
      {view.reasons.length > 0 && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            background: "#fff3cd",
            border: `1px solid ${view.color}`,
            borderRadius: "4px",
            fontSize: "13px",
            color: view.color,
          }}
        >
          {view.reasons.map((reason, i) => (
            <div key={i}>{reason}</div>
          ))}
        </div>
      )}
    </div>
  );
}
