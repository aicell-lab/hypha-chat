import React, { useState, useRef } from "react";
import { useHyphaStore } from "../store/hypha";
import AttachmentIcon from "../icons/attachment.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import { showToast } from "./ui-lib";
import Locale from "../locales";

interface FileUploadProps {
  onFileUploaded?: (fileName: string) => void;
}

// We need to import ChatAction or define it here
// For now, let's define the ChatAction props interface
interface ChatActionProps {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
  fullWidth?: boolean;
  selected?: boolean;
}

export function FileUpload({ onFileUploaded }: FileUploadProps) {
  const {
    defaultProject,
    user,
    isConnected,
    initializeDefaultProject,
    uploadFileToProject: storeUploadFile,
  } = useHyphaStore();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = async () => {
    if (!isConnected || !user) {
      showToast("Please log in to upload files");
      return;
    }

    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // File size limit (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast("File too large. Maximum size is 10MB.");
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // Ensure default project exists
      if (!defaultProject) {
        setUploadProgress(10);
        await initializeDefaultProject();
      }

      // Upload file with progress tracking
      setUploadProgress(25);
      await storeUploadFile(file, (progress: number) => {
        setUploadProgress(25 + Math.round((progress / 100) * 65)); // Scale progress from 25% to 90%
      });
      setUploadProgress(90);

      setUploadProgress(100);
      showToast(`File "${file.name}" uploaded successfully!`);
      onFileUploaded?.(file.name);

      // Clear progress after 1 second
      setTimeout(() => {
        setUploadProgress(0);
      }, 1000);
    } catch (error) {
      console.error("File upload failed:", error);
      showToast(
        `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const getText = () => {
    if (isUploading) {
      return `Uploading... ${uploadProgress}%`;
    }
    return Locale.Chat.InputActions.UploadFile;
  };

  const getIcon = () => {
    if (isUploading) {
      return <LoadingButtonIcon />;
    }
    return <AttachmentIcon />;
  };

  // Return props for external ChatAction usage
  return {
    onClick: handleClick,
    text: getText(),
    icon: getIcon(),
    fileInput: (
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        style={{ display: "none" }}
        accept="*/*"
        aria-label="Upload file"
      />
    ),
  };
}
