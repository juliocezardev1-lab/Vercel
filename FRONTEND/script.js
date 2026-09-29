class Produto {
    #preco;
    #quantidade;

    constructor(nome, preco, quantidade) {
        if (!nome || preco <= 0 || quantidade <= 0) {
            throw new Error('Dados inválidos para o produto');
        }
        this.nome = nome;
        this.#preco = parseFloat(preco);
        this.#quantidade = parseInt(quantidade);
    }
    get preco() { return this.#preco; }
    get quantidade() { return this.#quantidade; }
    valorTotal() { return this.#preco * this.#quantidade; }
    toJSON() {
        return { nome: this.nome, preco: this.#preco, quantidade: this.#quantidade };
    }
}

const API_URL = '/produtos';
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = new Intl.NumberFormat('pt-BR');
const formulario = document.getElementById('produto-form');
const tabela = document.querySelector('#tabela-produtos tbody');
const botaoLimpar = document.getElementById('limpar-tabela');
const feedback = document.getElementById('feedback');
const estadoEstoque = document.getElementById('estado-estoque');

function mostrarMensagem(texto, tipo = 'sucesso') {
    feedback.textContent = texto;
    feedback.dataset.tipo = tipo;
    feedback.hidden = false;
}

function mostrarEstadoTabela(titulo, descricao, vazio = false) {
    const linha = document.createElement('tr');
    linha.className = 'state-row';
    const celula = document.createElement('td');
    celula.colSpan = 5;
    if (vazio) {
        const simbolo = document.createElement('span');
        simbolo.className = 'empty-stamp';
        simbolo.textContent = '✦';
        simbolo.setAttribute('aria-hidden', 'true');
        celula.appendChild(simbolo);
    }
    const destaque = document.createElement('strong');
    destaque.textContent = titulo;
    const detalhe = document.createElement('span');
    detalhe.textContent = descricao;
    celula.append(destaque, detalhe);
    linha.appendChild(celula);
    tabela.replaceChildren(linha);
}

async function verificarResposta(resposta, mensagem) {
    if (resposta.ok) return;
    const dados = await resposta.json().catch(() => null);
    throw new Error(dados?.erro || mensagem);
}

// Os números do resumo sempre vêm da lista devolvida pelo banco.
async function renderizarTabela() {
    try {
        const resposta = await fetch(API_URL);
        await verificarResposta(resposta, 'Não foi possível carregar os produtos.');
        const dados = await resposta.json();
        if (!Array.isArray(dados)) throw new Error('Resposta inválida recebida do servidor.');

        tabela.replaceChildren();
        let totalAcumulado = 0;
        let totalUnidades = 0;

        dados.forEach((item) => {
            const produto = new Produto(item.nome, item.preco, item.quantidade);
            totalAcumulado += produto.valorTotal();
            totalUnidades += produto.quantidade;
            const linha = document.createElement('tr');
            linha.className = 'product-row';

            // textContent mantém o nome do produto como texto, inclusive com < e >.
            [produto.nome, moeda.format(produto.preco), numero.format(produto.quantidade),
                moeda.format(produto.valorTotal())].forEach((valor) => {
                const celula = document.createElement('td');
                celula.textContent = valor;
                linha.appendChild(celula);
            });

            const acao = document.createElement('td');
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.textContent = 'Apagar';
            botao.setAttribute('aria-label', 'Apagar ' + produto.nome);
            botao.addEventListener('click', () => deletarProduto(item.id, botao));
            acao.appendChild(botao);
            linha.appendChild(acao);
            tabela.appendChild(linha);
        });

        if (dados.length === 0) {
            mostrarEstadoTabela('Por aqui, só espaço livre.', 'Cadastre seu primeiro produto para começar.', true);
        }
        document.getElementById('total-produtos').textContent = numero.format(dados.length);
        document.getElementById('total-unidades').textContent = numero.format(totalUnidades);
        document.getElementById('total-estoque').textContent = 'Total em estoque: ' + moeda.format(totalAcumulado);
        botaoLimpar.disabled = dados.length === 0;
        estadoEstoque.textContent = 'Estoque atualizado';
        estadoEstoque.dataset.status = 'ok';
        return true;
    } catch (erro) {
        mostrarEstadoTabela('Não foi possível carregar o estoque.', 'Atualize a página para tentar novamente.');
        document.getElementById('total-produtos').textContent = '—';
        document.getElementById('total-unidades').textContent = '—';
        document.getElementById('total-estoque').textContent = 'Total em estoque: indisponível';
        botaoLimpar.disabled = true;
        estadoEstoque.textContent = 'Falha ao carregar o estoque';
        estadoEstoque.dataset.status = 'erro';
        console.error('Erro ao buscar produtos:', erro.message);
        return false;
    }
}

formulario.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    const botao = formulario.querySelector('button[type="submit"]');
    if (botao.disabled) return;
    botao.disabled = true;
    formulario.setAttribute('aria-busy', 'true');
    feedback.hidden = true;
    try {
        const produto = new Produto(
            document.getElementById('nome').value,
            document.getElementById('preco').value,
            document.getElementById('quantidade').value
        );
        const resposta = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(produto.toJSON())
        });
        await verificarResposta(resposta, 'Não foi possível cadastrar o produto.');
        formulario.reset();
        const atualizado = await renderizarTabela();
        mostrarMensagem(
            atualizado ? 'Pronto! Produto adicionado ao estoque.' : 'Produto salvo, mas a lista não pôde ser atualizada. Recarregue a página.',
            atualizado ? 'sucesso' : 'erro'
        );
    } catch (erro) {
        mostrarMensagem(erro.message, 'erro');
    } finally {
        botao.disabled = false;
        formulario.removeAttribute('aria-busy');
    }
});

async function deletarProduto(id, botao) {
    if (id === undefined || id <= 0 || botao.disabled) return;
    botao.disabled = true;
    feedback.hidden = true;
    try {
        const resposta = await fetch(API_URL + '/' + id, { method: 'DELETE' });
        await verificarResposta(resposta, 'Não foi possível apagar o produto.');
        const atualizado = await renderizarTabela();
        mostrarMensagem(
            atualizado ? 'Produto removido. Tudo em ordem!' : 'Produto removido, mas a lista não pôde ser atualizada. Recarregue a página.',
            atualizado ? 'sucesso' : 'erro'
        );
    } catch (erro) {
        botao.disabled = false;
        mostrarMensagem(erro.message, 'erro');
    }
}

botaoLimpar.addEventListener('click', async function () {
    if (botaoLimpar.disabled) return;
    botaoLimpar.disabled = true;
    feedback.hidden = true;
    try {
        const resposta = await fetch(API_URL, { method: 'DELETE' });
        await verificarResposta(resposta, 'Não foi possível limpar o estoque.');
        const atualizado = await renderizarTabela();
        mostrarMensagem(
            atualizado ? 'Tabela limpa. Pronta para um novo começo.' : 'Tabela limpa, mas a lista não pôde ser atualizada. Recarregue a página.',
            atualizado ? 'sucesso' : 'erro'
        );
    } catch (erro) {
        botaoLimpar.disabled = false;
        mostrarMensagem(erro.message, 'erro');
    }
});

renderizarTabela();
