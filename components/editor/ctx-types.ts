// أنواع مشتركة لسياق المعالجات المستخرجة من Editor.tsx (ai-actions / export-actions / timeline-actions / project-actions).
import type { AppNotification } from "@/lib/types";

export type NotifyFn = (type: AppNotification["type"], title: string, message?: string) => void;
export type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
