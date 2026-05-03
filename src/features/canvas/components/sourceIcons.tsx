"use client";

import { FileCode2, FileImage, FileText, Sparkles, Video } from "lucide-react";
import type { ReactNode } from "react";

import type { SourceType } from "../types";

export const sourceIcons: Record<SourceType, ReactNode> = {
  markdown: <FileText size={19} />,
  html: <FileCode2 size={19} />,
  image: <FileImage size={19} />,
  video: <Video size={19} />,
  prompt: <Sparkles size={19} />,
  file: <FileText size={19} />
};
