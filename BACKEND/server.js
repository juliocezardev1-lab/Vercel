const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;


// MIDDLEWARES

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

app.use(express.static(path.join(__dirname, '../FRONTEND')));


// ROTA PRINCIPAL

app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, '../FRONTEND/index.html')
    );
});


// BUSCAR PRODUTOS

app.get('/produtos', async (req, res) => {
    try {
        const resultado = await db.query('SELECT * FROM public.produtos ORDER BY id');
        res.status(200).json(resultado.rows);
    } catch (erro) {
        console.error('Erro ao buscar produtos:', erro.code || 'DATABASE_ERROR');
        res.status(500).json({
            erro: 'Erro ao buscar produtos'
        });
    }
});


// CADASTRAR PRODUTO

app.post('/produtos', async (req, res) => {
    const { nome, preco, quantidade } = req.body || {};

    const p = parseFloat(preco);
    const q = parseInt(quantidade);

    if (
        !nome ||
        !Number.isFinite(p) ||
        !Number.isFinite(q) ||
        p <= 0 ||
        q <= 0
    ) {
        return res.status(400).json({
            erro: 'Dados inválidos enviados para o servidor'
        });
    }

    try {
        const resultado = await db.query(
            `INSERT INTO public.produtos (nome, preco, quantidade)
             VALUES ($1, $2, $3)
             RETURNING id, nome, preco, quantidade`,
            [nome, p, q]
        );

        res.status(201).json(resultado.rows[0]);
    } catch (erro) {
        console.error('Erro ao cadastrar produto:', erro.code || 'DATABASE_ERROR');
        res.status(500).json({
            erro: 'Erro ao cadastrar produto'
        });
    }
});


// APAGAR TODOS OS PRODUTOS

app.delete('/produtos', async (req, res) => {
    try {
        await db.query('DELETE FROM public.produtos');
        res.status(204).send();
    } catch (erro) {
        console.error('Erro ao limpar produtos:', erro.code || 'DATABASE_ERROR');
        res.status(500).json({
            erro: 'Erro ao limpar produtos'
        });
    }
});


// APAGAR UM PRODUTO PELO ID

app.delete('/produtos/:id', async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            erro: 'ID inválido'
        });
    }

    try {
        const resultado = await db.query(
            'DELETE FROM public.produtos WHERE id = $1',
            [id]
        );

        if (resultado.rowCount === 0) {
            return res.status(404).json({
                erro: 'Produto não encontrado'
            });
        }

        res.status(204).send();
    } catch (erro) {
        console.error('Erro ao apagar produto:', erro.code || 'DATABASE_ERROR');
        res.status(500).json({
            erro: 'Erro ao apagar produto'
        });
    }
});


// INICIALIZAÇÃO LOCAL; NA VERCEL O APLICATIVO É EXPORTADO COMO FUNÇÃO.

if (require.main === module && !process.env.VERCEL) {
    db.inicializar()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Servidor backend rodando em http://localhost:${PORT}`);
            });
        })
        .catch(async (erro) => {
            console.error('Erro ao iniciar o banco de dados:', erro.code || 'DATABASE_ERROR');
            await db.encerrar();
            process.exitCode = 1;
        });
}

module.exports = app;
