// import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Workspace } from 'obsidian';
import { Editor, MarkdownView, Plugin } from 'obsidian';

interface RecursiveFoldingSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: RecursiveFoldingSettings = {
	mySetting: 'default'
}

export default class RecursiveFolding extends Plugin {
	settings: RecursiveFoldingSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'collapse-selection',
			name: 'Collapse Selection',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.collapseSelection(editor, view);
			}
		});

		this.addCommand({
			id: 'fold-selection-recursive',
			name: 'Fold Selection Recursive',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.foldSelectionRecursive(editor, view);
			}
		});

		this.addCommand({
			id: 'toggle-fold-recursive',
			name: 'Toggle Fold Recursive',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.toggleFoldRecursiveAutoSelect(editor, view);
				// 不具合：
				//  collapse時、カーソル位置と選択範囲の復帰に失敗することがある。
				// 以下でログに出力した値は想定通りである。
				// ただし、当command完了後、実際の「カーソル位置と選択範囲」が想定外となっている。
				// 再現率100%、ただし再現法則は未整理。
				// 仮説、h1～h6の行の次に、非h1～h6行があればOK（空行でもよい）。
				//      なければ不具合発生。
				// 対策案、h1～h6行の直後にh1～h6を配置したい場合、空行を挟んでおく
				if (this.isDebugMode()) console.log(editor.getCursor());
				if (this.isDebugMode()) console.log(editor.somethingSelected());
				if (this.isDebugMode()) console.log(editor.listSelections());
			}
		});

		this.addCommand({
			id: 'select-header-or-list',
			name: 'Select Header or List',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// 用途：ユーザーが挙動をつかみやすくなりユーザーが楽
				this.selectCurrentLayer(editor, view);
			}
		});
	}

	isDebugMode(): boolean {
		return false;
	}

	toggleFoldRecursiveAutoSelect(editor: Editor, view: MarkdownView): void {
		const isSelected = editor.somethingSelected();
		const selections0 = editor.listSelections();
		const pos0 = editor.getCursor();
		// 先頭がfoldedかを判定する
		// 注意、ここでposとselectionが変化する
		const isFolded = this.isFolded_by_pos_or_selection(editor, view);
		if (isFolded) {
			if (this.isDebugMode()) console.log("toggleFoldRecursiveAutoSelect 現在の階層は折りたたまれています");
		} else {
			if (this.isDebugMode()) console.log("toggleFoldRecursiveAutoSelect 現在の階層は折りたたまれていません");
		}
		// isFoldedで変化したselectionsとposを復帰する
		if (isSelected) {
			editor.setSelections(selections0);
		} else {
			editor.setCursor(pos0);
		}

		if (isSelected) {
			// 選択している場合、現在の選択範囲を対象にする
		} else {
			// 選択していない場合、現在の階層を自動で選択する
			this.selectCurrentLayer(editor, view);
		}

		if (isFolded) {
			this.collapseSelection(editor, view);
		} else {
			this.foldSelectionRecursive(editor, view);
		}
		// fold/collapseで変化したselectionsとposを復帰する
		if (isSelected) {
			editor.setSelections(selections0);
		} else {
			editor.setCursor(pos0);
		}
	}
	isFolded_by_pos_or_selection(editor: Editor, view: MarkdownView): boolean {
		// selectionとposが変化するので、呼び出し元で退避と復帰をすること
		if (editor.somethingSelected()) {
			// 範囲選択している場合、選択範囲の前方側を対象にする
			const sel = this.get_y0y1_fromSelection_forFoldCollapse(editor, view);
			this.setCursorY(editor, view, sel.y0);
		}
		const isFolded = this.isFolded(editor, view, this.getCursorY(editor, view));
		return isFolded;
	}

	selectCurrentLayer(editor: Editor, view: MarkdownView): void {
		const y0 = this.getCursorY(editor, view);
		const y1 = this.getLayerGroupEnd(editor, view, y0);
		if (y0 == y1) {
			if (this.isDebugMode()) console.log("selectCurrentLayer 選べるのは現在行の1行しかありません")
			return;
		}
		editor.setSelection({ line: y0, ch: 0 }, { line: y1, ch: 0 });
		// なぜ ch: 0 なの？
		//   → できるだけ非破壊にする用。collapseさせない用。
		//     x1を求めようとして自動的にcollapseしてしまう、を防止する。
		//     要はfoldされた行内にカーソルがいくと自動collapseしてしまう。
		// 別件、foldされた行の次の行をselectならcollapseはない、動作確認済み。
		// 補足、もしy1 > lastLine でもObsidian側が補正してくれるのでOK、動作確認済み。
	}

	collapseSelection(editor: Editor, view: MarkdownView): void {
		const sel = this.get_y0y1_fromSelection_forFoldCollapse(editor, view);
		if (this.isDebugMode()) console.log("選択範囲をcollapseします");
		if (this.isDebugMode()) console.log(sel);
		this.collapse_y0y1(editor, view, sel.y0, sel.y1);
	}

	foldSelectionRecursive(editor: Editor, view: MarkdownView): void {
		const sel = this.get_y0y1_fromSelection_forFoldCollapse(editor, view);
		if (this.isDebugMode()) console.log("選択範囲をcollapseしてfoldします");
		if (this.isDebugMode()) console.log(sel);
		this.collapse_y0y1(editor, view, sel.y0, sel.y1);
		// 意図。一度collapseすることで、すべてtoggleでfold可能とする。
		this.toggleFold_y0y1(editor, view, sel.y0, sel.y1);
	}

	get_y0y1_fromSelection_forFoldCollapse(editor: Editor, view: MarkdownView): { y0: number, y1: number } {
		const selections0 = editor.listSelections();
		const yAnchor = selections0[0].anchor.line;
		const yHead = selections0[0].head.line;
		const y0 = Math.min(yAnchor, yHead);
		let y1 = Math.max(yAnchor, yHead);
		if (y0 < y1) y1--; // endの1行前までをfold/collapseの対象にする
		if (this.isDebugMode()) console.log("get_y0y1_fromSelection y0[" + y0 + "] y1[" + y1 + "]");
		return { y0: y0, y1: y1 };
	}

	collapse_y0y1(editor: Editor, view: MarkdownView, y0: number, y1: number): void {
		for (let y = y1; y >= y0; y--) { // この順番にすると成功した
			if (this.isDebugMode()) console.log("collapseします y[" + y + "]");
			this.setCursorY(editor, view, y);
		}
	}

	toggleFold_y0y1(editor: Editor, view: MarkdownView, y0: number, y1: number): void {
		for (let y = y1; y >= y0; y--) {
			if (this.isDebugMode()) console.log("foldします y[" + y + "]");
			this.setCursorY(editor, view, y);
			editor.exec('toggleFold');
		}
	}

	getLayerGroupEnd(editor: Editor, view: MarkdownView, y0:number): number {
		const layer0 = this.getLayerByY(editor, view, y0);
		if (y0 == editor.lastLine()) return y0 + 1; // 最終行ならその次を示して早期リターン
		for (let y = y0 + 1; y < editor.lastLine(); y++) {
			const layerNow = this.getLayerByY(editor, view, y);
			if (this.isDebugMode()) console.log("getLayerGroupEnd y[" + y + "] layer0[" + layer0 + "] to layerNow[" + layerNow + "]");
			if (layerNow <= layer0) {
				if (this.isDebugMode()) console.log("getLayerGroupEnd y[" + y + "] がendです");
				return y;
			}
		}
		if (this.isDebugMode()) console.log("getLayerGroupEnd 最後の行の次がendです");
		return editor.lastLine() + 1;
	}

	getLayerByY(editor: Editor, view: MarkdownView, y:number): number {
		const line = editor.getLine(y);
		return this.getLayer(line);
	}

	getLayer(line:string): number {
		if (this.isHeaderLayer(line)) {
			return this.countSharp(line);
		} else {
			const ofs = 6;
			if (line[0] == '\t') {
				const numOfTab = this.countSpaceOrTab(line);
				return numOfTab + ofs;
			} else if (line[0] == ' ') {
				// FIXME softTab 2tab (get setting soft tab)
				const numOfSpace = this.countSpaceOrTab(line);
				const spaceOfSoftTab = 4;
				return numOfSpace / spaceOfSoftTab + ofs;
			} else {
				// 行頭コードブロック等は、bullet list最上位階層と同じ扱いにする
				return ofs;
			}
		}
	}

	countSharp(s: string): number {
		let count = 0;
		for (let i = 0; i < s.length; i++) {
			if (s[i] !== "#") {
				break;
			}
			count++;
		}
		return count;
	}

	countSpaceOrTab(s: string): number {
		let count = 0;
		for (let i = 0; i < s.length; i++) {
			if (s[i] == ' ' || s[i] == '\t') {
				count++;
				continue;
			}
			break;
		}
		return count;
	}

	isHeaderLayer(line: string): boolean {
		return (line.slice(0, 1) === '#');
	}

	isFolded(editor: Editor, view: MarkdownView, y0: number): boolean {
		// 注意、カーソル位置と選択範囲が変化するため、呼び出し元で必要に応じて復帰すること
		if (y0 == editor.lastLine()) return false;

		this.setCursorY(editor, view, y0);
		this.goNextLineByGoDownRepeat(editor, view);
		const afterY = this.getCursorY(editor, view);
		this.goPreLineByGoUpRepeat(editor, view); // これがないとcollapse後にカーソルが想定外の場所に飛んでしまった

		if (this.isDebugMode()) console.log("isFolded afterY[" + afterY + "] y0+1[" + (y0 + 1) + "]");
		if (afterY > y0 + 1) {
			if (this.isDebugMode()) console.log("isFolded 次の行より先にいったので、folded");
			return true;
		} else if (afterY == y0 + 1) {
			if (this.isDebugMode()) console.log("isFolded 次の行にいったので、not folded");
			return false;
		} else {
			if (this.isDebugMode()) console.log("isFolded 想定外です");
			return true;
		}
	}

	// 折返し時にgoDownは次のlineに行けないので
	goNextLineByGoDownRepeat(editor: Editor, view: MarkdownView): void {
		const y0 = this.getCursorY(editor, view);
		if (y0 == editor.lastLine()) return;
		for (let i = 0; i < 256; i++) { // 256行以上の折り返しを扱うことはない想定
			if (this.isDebugMode()) console.log("goNextLineByGoDownRepeat before y[" + this.getCursorY(editor, view) + "]");
			editor.exec('goDown');
			if (this.isDebugMode()) console.log("goNextLineByGoDownRepeat after  y[" + this.getCursorY(editor, view) + "]");
			const afterY = this.getCursorY(editor, view);
			if (afterY > y0) {
				this.setCursorY(editor, view, this.getCursorY(editor, view)); // これがないとnote末尾でのfold/collapseでカーソルが想定外の場所に移動してしまった
				return; // 備忘、fold中は y0 + 1 超になる
			}
		}
	}

	goPreLineByGoUpRepeat(editor: Editor, view: MarkdownView): void {
		const y0 = this.getCursorY(editor, view);
		if (y0 == 0) return;
		for (let i = 0; i < 256; i++) {
			editor.exec('goUp');
			const afterY = this.getCursorY(editor, view);
			if (afterY < y0) {
				return;
			}
		}
	}

	getCursorY(editor: Editor, view: MarkdownView): number {
		return editor.getCursor().line;
	}

	setCursorY(editor: Editor, view: MarkdownView, y:number): void {
		editor.setCursor( { line: y, ch: 0} );
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
