import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link as LinkIcon,
  Type,
  Minus,
  Eye,
  Save,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const FONT_FAMILIES = [
  { value: "Calibri, sans-serif", label: "Calibri" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "Tahoma, sans-serif", label: "Tahoma" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet MS" },
  { value: "'Segoe UI', sans-serif", label: "Segoe UI" },
  { value: "Helvetica, sans-serif", label: "Helvetica" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Garamond, serif", label: "Garamond" },
  { value: "'Palatino Linotype', serif", label: "Palatino" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Consolas, monospace", label: "Consolas" },
  { value: "Monaco, monospace", label: "Monaco" },
];

const FONT_SIZES = [
  { value: "13px", label: "10" },
  { value: "14px", label: "11" },
  { value: "15px", label: "12" },
  { value: "16px", label: "13" },
  { value: "18px", label: "14" },
  { value: "20px", label: "15" },
  { value: "24px", label: "16" },
  { value: "26px", label: "18" },
  { value: "28px", label: "20" },
  { value: "30px", label: "24" },
  { value: "32px", label: "28" },
  { value: "34px", label: "32" },
  { value: "36px", label: "36" },
];

const COLOR_FAMILIES = [
  {
    name: "Black",
    colors: ["#000000", "#1a1a1a", "#333333", "#4d4d4d", "#666666", "#808080", "#999999", "#b3b3b3"]
  },
  {
    name: "Blue",
    colors: ["#35516e", "#0d2741", "#007dfa", "#2189f1", "#1a8cff", "#1364b6", "#07437a", "#032442"]
  },
  {
    name: "Yellow",
    colors: ["#ffffe6", "#ffffcc", "#ffffb3", "#ffff99", "#ffff80", "#ffff66", "#ffff4d", "#ffff33"]
  },
  {
    name: "Red",
    colors: ["#521212", "#a04949", "#da8c8c", "#c25454", "#fa4f4f", "#e92424", "#e60e0e", "#920303"]
  },
  {
    name: "Green",
    colors: ["#e6ffe6", "#ccffcc", "#b3ffb3", "#99ff99", "#80ff80", "#66ff66", "#4dff4d", "#33ff33"]
  }
];

const applyBgColor = (color, editorRef) => {
  if (document.queryCommandSupported("hiliteColor")) {
    document.execCommand("hiliteColor", false, color);
  } else {
    document.execCommand("backColor", false, color);
  }
  editorRef.current?.focus();
};

export default function CreatePitch({ pitch, onSaved }) {
  const editorRef = useRef(null);
  const navigate = useNavigate();

  const [pitchName, setPitchName] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const [currentFont, setCurrentFont] = useState("Calibri, sans-serif");
  const [currentSize, setCurrentSize] = useState("13px");
  const [currentColor, setCurrentColor] = useState("#000000");
  const [showColors, setShowColors] = useState(false);
  const [pitchType, setPitchType] = useState("fresh");
  const [showBgColors, setShowBgColors] = useState(false);

  const format = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  const applyFontSize = (size) => {
    setCurrentSize(size);

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedContent = range.extractContents();
    
    const span = document.createElement('span');
    span.style.fontSize = size;
    span.appendChild(selectedContent);
    
    range.insertNode(span);
    
    const editor = editorRef.current;
    if (editor) {
      normalizeSpans(editor);
    }

    editorRef.current?.focus();
  };

  const normalizeSpans = (element) => {
    const spans = element.querySelectorAll('span');
    spans.forEach(span => {
      if (!span.textContent.trim() && !span.innerHTML.trim()) {
        span.remove();
        return;
      }

      if (span.style.length === 1 && span.style.fontSize && !span.attributes.length > 1) {
        return;
      }
    });
  };

  const applyFontFamily = (fontFamily) => {
    setCurrentFont(fontFamily);
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedContent = range.extractContents();
    
    const span = document.createElement('span');
    span.style.fontFamily = fontFamily;
    span.appendChild(selectedContent);
    
    range.insertNode(span);
    
    editorRef.current?.focus();
  };

  useEffect(() => {
    if (pitch) {
      setPitchName(pitch.name || "");
      setPitchType(pitch.type || "fresh");
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = pitch.bodyHtml || "";
        }
      }, 0);
    }
  }, [pitch]);

  // ✅ Extract the actual dominant text color from editor HTML
  // Reads from font tags, span color styles, or falls back to currentColor state
  const extractDominantColor = (html) => {
    const UNSAFE = new Set(['#fff', '#ffffff', 'white', 'transparent', 'inherit', '']);
    
    // Check <font color="..."> tags (browser uses these for execCommand foreColor)
    const fontColorMatch = html.match(/<font[^>]*color="(#[0-9a-fA-F]{3,6})"/i);
    if (fontColorMatch) {
      const c = fontColorMatch[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) return c;
    }
    
    // Check <span style="color:..."> tags
    const spanColorMatch = html.match(/<span[^>]*style="[^"]*color:\s*(#[0-9a-fA-F]{3,6})/i);
    if (spanColorMatch) {
      const c = spanColorMatch[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) return c;
    }

    // Fallback to currentColor state (set when user clicks color picker)
    if (currentColor && !UNSAFE.has(currentColor.toLowerCase())) return currentColor;
    
    return '#000000';
  };

  const handleSave = async () => {
    const editor = editorRef.current;
    if (!editor) return;

    normalizeSpans(editor);

    let html = editor.innerHTML || "";
    
    // ✅ Always detect the actual color from the editor content
    const dominantColor = extractDominantColor(html);
    
    // Always wrap in a div with the correct detected color so extractBaseStyles works reliably
    // Strip existing outer wrapper first if present to avoid double-wrapping
    const strippedHtml = html.trim().startsWith('<div') && html.includes('style=')
      ? html  // already has wrapper - update its color below
      : html;

    html = `<div style="font-family: Calibri, sans-serif; font-size: 13px; line-height: 1.6; color: ${dominantColor};">${strippedHtml}</div>`;

    const text = html.replace(/<[^>]*>/g, "").toLowerCase();

    const forbidden = [
      "regards",
      "best regards",
      "kind regards",
      "thanks & regards",
      "thanks and regards",
    ];

    const hasSignature = forbidden.some(word => text.includes(word));

    if (hasSignature) {
      alert("Do not add Regards or signature in pitch. Signature will be added automatically.");
      return;
    }

    const token = localStorage.getItem("token");

    const url = pitch
      ? `${API_BASE_URL}/api/pitches/${pitch.id}`
      : `${API_BASE_URL}/api/pitches`;

    const method = pitch ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: pitchName,
          bodyHtml: html,
          type: pitchType,
        }),
      });

      if (!res.ok) {
        alert("Failed to save");
        return;
      }

      alert(pitch ? "Pitch updated" : "Pitch created");

      if (onSaved) {
        onSaved();
      }

      navigate("/pitches", { replace: true });
    } catch (error) {
      console.error(error);
      alert("Server error");
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 rounded-2xl p-6 border border-sky-200 dark:border-sky-800">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">
          {pitch ? "Edit Pitch" : "Create Pitch"}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Design reusable email pitch templates</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 space-y-5">
          <div className="bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-xl p-5 shadow-lg">
            <label className="text-sm font-medium block mb-2 text-slate-700 dark:text-slate-300">Pitch Name</label>
            <input
              value={pitchName}
              onChange={(e) => setPitchName(e.target.value)}
              placeholder="Cold Outreach pitch"
              className="w-full border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-sky-500 transition-all"
            />
          </div>

          <div className="bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-xl p-5 shadow-lg">
            <label className="text-sm font-medium block mb-2 text-slate-700 dark:text-slate-300">Pitch Type</label>
            <select
              value={pitchType}
              onChange={(e) => setPitchType(e.target.value)}
              className="w-full border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-sky-500 transition-all"
            >
              <option value="fresh">Fresh Mail (Pitch)</option>
              <option value="followup">Follow Up (Pitch)</option>
            </select>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-xl overflow-hidden shadow-lg">
            <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 border-b border-sky-200 dark:border-sky-800 p-3 flex flex-wrap gap-2 items-center">
              <select
                value={currentFont}
                onChange={(e) => applyFontFamily(e.target.value)}
                className="border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-xs px-3 py-2 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>

              <select
                value={currentSize}
                onChange={(e) => applyFontSize(e.target.value)}
                className="border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-xs px-3 py-2 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
              >
                {FONT_SIZES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}px</option>
                ))}
              </select>

              <Divider />

              <Btn icon={<Bold size={16} />} onClick={() => format("bold")} />
              <Btn icon={<Italic size={16} />} onClick={() => format("italic")} />
              <Btn icon={<Underline size={16} />} onClick={() => format("underline")} />
              <Btn icon={<Strikethrough size={16} />} onClick={() => format("strikeThrough")} />

              <Divider />

              <Btn icon={<AlignLeft size={16} />} onClick={() => format("justifyLeft")} />
              <Btn icon={<AlignCenter size={16} />} onClick={() => format("justifyCenter")} />
              <Btn icon={<AlignRight size={16} />} onClick={() => format("justifyRight")} />
              <Btn icon={<AlignJustify size={16} />} onClick={() => format("justifyFull")} />

              <Divider />

              <Btn icon={<List size={16} />} onClick={() => format("insertUnorderedList")} />
              <Btn icon={<ListOrdered size={16} />} onClick={() => format("insertOrderedList")} />

              <Divider />

              <Btn icon={<LinkIcon size={16} />} onClick={() => {
                const url = prompt("Enter URL");
                if (url) format("createLink", url);
              }} />

              <Btn icon={<Minus size={16} />} onClick={() => format("insertHorizontalRule")} />

              <div className="relative">
                <button 
                  onClick={() => setShowColors(!showColors)} 
                  className="p-2 hover:bg-sky-100 dark:hover:bg-sky-900/30 text-sky-700 dark:text-sky-400 rounded-lg transition-all"
                  title="Text Color"
                >
                  <Type size={18} />
                </button>

                {showColors && (
                  <div
                      className="absolute right-0 mt-2 bg-white dark:bg-slate-800 
                                    border border-sky-200 dark:border-sky-700 
                                    p-3 rounded-xl z-50 shadow-xl"
                          style={{ width: "280px" }}
                    >
                    {COLOR_FAMILIES.map((family, familyIndex) => (
                      <div key={family.name} className={familyIndex > 0 ? "mt-3 pt-3 border-t border-sky-200 dark:border-sky-700" : ""}>
                        <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">{family.name}</div>
                        <div className="grid grid-cols-8 gap-1">
                          {family.colors.map((color, colorIndex) => (
                            <button
                              key={`${family.name}-${colorIndex}`}
                              style={{ backgroundColor: color }}
                              className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform"
                              onClick={() => {
                                format("foreColor", color);
                                setShowColors(false);
                                setCurrentColor(color);
                              }}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => setShowBgColors(!showBgColors)}
                  className="p-2 hover:bg-sky-100 dark:hover:bg-sky-900/30 rounded-lg transition-all"
                  title="Text Background Color"
                >
                  <span className="text-sm font-bold px-2 py-1 bg-yellow-300 text-slate-900 rounded">A</span>
                </button>

                {showBgColors && (
                  <div className="absolute right-0 bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-700 p-3 rounded-xl z-50 shadow-xl" style={{ width: "280px" }}>
                    {COLOR_FAMILIES.map((family, familyIndex) => (
                      <div key={family.name} className={familyIndex > 0 ? "mt-3 pt-3 border-t border-sky-200 dark:border-sky-700" : ""}>
                        <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">{family.name}</div>
                        <div className="grid grid-cols-8 gap-1">
                          {family.colors.map((color, colorIndex) => (
                            <button
                              key={`${family.name}-${colorIndex}`}
                              style={{ backgroundColor: color }}
                              className="w-6 h-6 rounded border border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform"
                              onClick={() => {
                                applyBgColor(color, editorRef);
                                setShowBgColors(false);
                              }}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="min-h-[300px] p-6 outline-none bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              style={{
                fontFamily: "Calibri, sans-serif",
                fontSize: "13px",
                lineHeight: "1.6",
              }}
            />

            <div className="border-t border-sky-200 dark:border-sky-800 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 p-4 gap-3 flex justify-end">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-700 hover:bg-sky-50 dark:hover:bg-sky-900/30 border border-sky-200 dark:border-sky-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-all shadow-md hover:shadow-lg"
              >
                <Eye size={18} />
                {showPreview ? "Hide Preview" : "Show Preview"}
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-sky-500/30 hover:shadow-xl hover:shadow-sky-500/40"
              >
                <Save size={18} />
                Save Template
              </button>
            </div>
          </div>

          {showPreview && (
            <div className="bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-xl p-6 shadow-lg">
              <h3 className="text-sm font-semibold mb-4 text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Eye size={18} className="text-sky-600 dark:text-sky-400" />
                Preview
              </h3>
              <div
                className="border border-sky-200 dark:border-sky-700 p-6 rounded-lg bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/10 dark:to-blue-900/10"
                dangerouslySetInnerHTML={{ __html: editorRef.current?.innerHTML || "" }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Btn = ({ icon, onClick }) => (
  <button 
    onClick={onClick} 
    className="p-2 hover:bg-sky-100 dark:hover:bg-sky-900/30 text-slate-700 dark:text-slate-300 rounded-lg transition-all"
  >
    {icon}
  </button>
);

const Divider = () => <div className="w-px h-6 bg-sky-200 dark:bg-sky-700 mx-1" />;