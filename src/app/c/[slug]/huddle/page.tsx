"use client";

import { useEffect, useState } from "react";
import { useClinic } from "@/lib/clinicContext";
import { supabase } from "@/lib/supabaseClient";
import { HuddlePost } from "@/lib/types";
import { formatClockTime } from "@/lib/util";
import { STAFF_NAME_KEY } from "@/lib/constants";

export default function HuddlePage() {
  const { clinic } = useClinic();
  const [posts, setPosts] = useState<HuddlePost[]>([]);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<"today" | "week">("today");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setAuthor(localStorage.getItem(STAFF_NAME_KEY) ?? "");
    } catch {
      // Private browsing / blocked storage — just start blank.
    }
  }, []);

  useEffect(() => {
    if (!clinic) return;
    let cancelled = false;

    supabase
      .from("huddle_posts")
      .select("*")
      .eq("clinic_id", clinic.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setPosts((data as HuddlePost[]) ?? []);
      });

    const channel = supabase
      .channel(`clinic-huddle-${clinic.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "huddle_posts", filter: `clinic_id=eq.${clinic.id}` },
        (payload) => {
          setPosts((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((p) => p.id !== (payload.old as HuddlePost).id);
            const updated = payload.new as HuddlePost;
            const idx = prev.findIndex((p) => p.id === updated.id);
            if (idx === -1) return [updated, ...prev];
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [clinic?.id]);

  function rememberAuthor(name: string) {
    setAuthor(name);
    try {
      localStorage.setItem(STAFF_NAME_KEY, name);
    } catch {
      // Ignore — just won't be remembered next time.
    }
  }

  async function submitPost() {
    if (!clinic) return;
    setError(null);
    const trimmedAuthor = author.trim();
    const trimmedBody = body.trim();
    if (!trimmedAuthor || !trimmedBody) {
      setError("Enter your name and a message.");
      return;
    }
    const { error: insertErr } = await supabase.from("huddle_posts").insert({
      clinic_id: clinic.id,
      author: trimmedAuthor,
      body: trimmedBody,
      category
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setBody("");
  }

  async function togglePin(post: HuddlePost) {
    await supabase.from("huddle_posts").update({ pinned: !post.pinned }).eq("id", post.id);
  }

  async function deletePost(id: string) {
    await supabase.from("huddle_posts").delete().eq("id", id);
  }

  const pinned = posts.filter((p) => p.pinned);
  const rest = posts.filter((p) => !p.pinned);

  function PostRow({ post }: { post: HuddlePost }) {
    return (
      <div className="card p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm">{post.author}</span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                post.category === "today"
                  ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                  : "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300"
              }`}
            >
              {post.category === "today" ? "Today" : "This week"}
            </span>
            <span className="text-xs text-slate-500">
              {new Date(post.created_at).toLocaleDateString()} · {formatClockTime(post.created_at)}
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">{post.body}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className={`text-xs font-semibold px-2 py-1 rounded-md border ${
              post.pinned
                ? "bg-amber-500 border-amber-500 text-white"
                : "border-slate-300 dark:border-slate-600 text-slate-500"
            }`}
            onClick={() => togglePin(post)}
          >
            {post.pinned ? "Unpin" : "Pin"}
          </button>
          <button className="text-xs font-semibold text-red-600" onClick={() => deletePost(post.id)}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card p-5 mb-5">
        <h3 className="font-bold mb-3">Post to the huddle board</h3>
        <div className="grid gap-3 sm:grid-cols-[200px_1fr] mb-3">
          <input
            className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm"
            placeholder="Your name"
            value={author}
            onChange={(e) => rememberAuthor(e.target.value)}
          />
          <select
            className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as "today" | "week")}
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
          </select>
        </div>
        <textarea
          className="w-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm mb-3"
          rows={3}
          placeholder="What's the team need to know?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <button className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-semibold px-4 py-2 rounded-lg" onClick={submitPost}>
          Post
        </button>
      </div>

      {pinned.length > 0 && (
        <div className="mb-5">
          <div className="text-xs font-semibold text-slate-500 mb-2">Pinned</div>
          <div className="space-y-3">
            {pinned.map((p) => (
              <PostRow key={p.id} post={p} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rest.map((p) => (
          <PostRow key={p.id} post={p} />
        ))}
        {posts.length === 0 && <div className="text-slate-400 text-sm py-6 text-center">No posts yet.</div>}
      </div>
    </div>
  );
}
