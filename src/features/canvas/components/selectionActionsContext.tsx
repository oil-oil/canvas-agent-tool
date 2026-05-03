"use client";

import React from "react";

import type { SelectionActions } from "../types";

export const SelectionActionsContext = React.createContext<SelectionActions | null>(null);
