// 「点击数字 → 键盘编辑」的数字控件。
// 「参数调节」栏里的「宽度 / 色数上限 / 容差」三行共用同一个组件：
//   默认状态下它只是一个数字（外观和原来的 <strong> 一样：强调色 + 右对齐），
//   点一下才变成输入框，并自动聚焦 + 全选当前值，可以直接敲新数字。
//   回车提交、失焦提交、Esc 取消（恢复原值）。
// 提交时把值夹到 min~max 并取整；空值/非法值恢复原值，绝不会变成 0。
const { useEffect, useRef, useState } = React;
export default function ParamNumberField({ ariaLabel, value, min, max, onCommit, text, onTextChange }) {
    const [editing, setEditing] = useState(false);
    const [innerText, setInnerText] = useState('');
    const inputRef = useRef(null);
    const buttonRef = useRef(null);
    // 回车/Esc 提交后把焦点还给数字本身，键盘可以连续操作；失焦提交则不动焦点
    const refocusRef = useRef(false);
    // 进入编辑时的文本，用来判断这次提交是不是「真改过」
    const initialTextRef = useRef('');
    const draft = text === undefined ? innerText : text;
    const setDraft = (next) => {
        if (text === undefined)
            setInnerText(next);
        else
            onTextChange?.(next);
    };
    // 进入编辑态：自动聚焦 + 全选，用户可以直接敲新数字覆盖旧值
    useEffect(() => {
        if (!editing)
            return;
        const input = inputRef.current;
        if (!input)
            return;
        input.focus();
        input.select();
    }, [editing]);
    useEffect(() => {
        if (editing || !refocusRef.current)
            return;
        refocusRef.current = false;
        buttonRef.current?.focus();
    }, [editing]);
    const startEditing = () => {
        // 记下进入编辑时的文本：用户点了数字又原样退出（没真改）时不该产生副作用，
        // 例如「容差」不能被白白标成「已手动设置」而导致自动校准停掉。
        initialTextRef.current = String(value);
        setDraft(String(value));
        setEditing(true);
    };
    const commit = () => {
        const raw = draft.trim();
        const n = Number(raw);
        // 空值/非法值 → 恢复原值（不是 0）
        const invalid = raw === '' || !Number.isFinite(n);
        const next = invalid ? value : Math.min(max, Math.max(min, Math.floor(n)));
        setEditing(false);
        setDraft(String(next));
        // 真改过才通知父级：容差靠这个把「已手动设置」标记和实际操作对上，
        // 否则自动校准会把手动填进去的值覆盖掉。原样退出则什么都不做。
        if (!invalid && raw !== initialTextRef.current)
            onCommit(next);
    };
    const cancel = () => {
        setEditing(false);
        setDraft(String(value));
    };
    if (editing) {
        return (React.createElement("input", { ref: inputRef, className: "param-number-input", "aria-label": ariaLabel, type: "number", min: min, max: max, step: 1, value: draft, onChange: (event) => {
                // 允许中间态为空（用户正在删），提交时才纠正；空值不会变成 0
                setDraft(event.target.value);
            }, onKeyDown: (event) => {
                // 输入法组合中不抢键：Enter 是在选词，Esc 是先取消候选
                if (event.nativeEvent.isComposing || event.keyCode === 229)
                    return;
                if (event.key === 'Enter') {
                    event.preventDefault();
                    refocusRef.current = true;
                    commit();
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    refocusRef.current = true;
                    cancel();
                }
            }, onBlur: commit }));
    }
    return (React.createElement("button", { ref: buttonRef, type: "button", className: "param-number", "aria-label": ariaLabel, onClick: startEditing }, value));
}
//# sourceMappingURL=ParamNumberField.js.map