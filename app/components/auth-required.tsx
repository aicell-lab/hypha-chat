import React from "react";
import LoginButton from "./login-button";
import Locale from "../locales";

interface AuthRequiredProps {
  message?: string;
}

export default function AuthRequired({ message }: AuthRequiredProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg p-8 text-center">
        <div className="mb-6">
          <svg
            className="mx-auto h-16 w-16 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>

        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Authentication Required
        </h3>

        <p className="text-gray-600 dark:text-gray-300 mb-6">
          {message || "Please log in to access the Hypha agent chat features."}
        </p>

        <LoginButton className="w-full" />

        <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
          Your session may have expired or you need to authenticate with the
          Hypha server.
        </p>
      </div>
    </div>
  );
}
